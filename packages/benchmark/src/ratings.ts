export const GLICKO_2_VERSION = "glicko-2-v1";
export type RatingAlgorithmVersion = typeof GLICKO_2_VERSION;
export const INITIAL_RATING = Object.freeze({ rating: 1500, deviation: 350, volatility: 0.06 });

export type BenchmarkScore = Readonly<{
  crossImps: number;
  matchpoints: Readonly<{ points: number; top: number }>;
}>;

export type RatingState = Readonly<{
  rating: number;
  deviation: number;
  volatility: number;
  sampleBoards: number;
}>;

export type RatingSnapshot = RatingState & Readonly<{ competitorId: string; eligible: boolean }>;
export type RatingPeriodObservation = Readonly<{
  competitorId: string;
  opponentId: string;
  /** An attributed field opponent may have a synthetic pre-period rating. Never added as a competitor. */
  opponentRating?: Readonly<Pick<RatingState, "rating" | "deviation">>;
  sampleBoards: number;
  rawScore: BenchmarkScore;
}>;
export type RatingScoreTransform = Readonly<{
  version: string;
  toFractionalScore: (score: BenchmarkScore, sampleBoards: number) => number;
}>;
export type RatedObservation = RatingPeriodObservation & Readonly<{ fractionalScore: number }>;
export type RatingPeriodResult = Readonly<{
  algorithmVersion: RatingAlgorithmVersion;
  scoreTransformVersion: string;
  ratings: readonly RatingSnapshot[];
  observations: readonly RatedObservation[];
}>;

const SCALE = 173.7178;
const TAU = 0.5;
const TOLERANCE = 0.000001;
const VOLATILITY_ITERATION_LIMIT = 100;
const UNRATED: RatingState = { ...INITIAL_RATING, sampleBoards: 0 };

type RatingParameters = Omit<RatingState, "sampleBoards">;

function validateScore({ crossImps, matchpoints: { points, top } }: BenchmarkScore): void {
  if (!Number.isFinite(crossImps) || !Number.isFinite(points) || !Number.isFinite(top) || points < 0 || top < points) {
    throw new RangeError("Invalid benchmark raw score");
  }
}

/** Sum the board metrics already attributed to a player. Matchpoint percentage is weighted by the board tops. */
export function aggregateBenchmarkScores(boards: readonly BenchmarkScore[]) {
  let crossImps = 0;
  let points = 0;
  let top = 0;
  for (const board of boards) {
    validateScore(board);
    crossImps += board.crossImps;
    points += board.matchpoints.points;
    top += board.matchpoints.top;
  }
  validateScore({ crossImps, matchpoints: { points, top } });
  return Object.freeze({
    sampleBoards: boards.length,
    crossImps,
    matchpoints: Object.freeze({ points, top, percentage: top === 0 ? null : (points / top) * 100 })
  });
}

export function isLeaderboardEligible({ sampleBoards, deviation }: Pick<RatingState, "sampleBoards" | "deviation">): boolean {
  return sampleBoards >= 20 && deviation < 100;
}

function validateRating({ rating, deviation, volatility, sampleBoards }: RatingState): void {
  if (!Number.isFinite(rating) || !Number.isFinite(deviation) || deviation <= 0 || !Number.isFinite(volatility) || volatility <= 0) {
    throw new RangeError("Invalid benchmark rating parameters");
  }
  if (!Number.isSafeInteger(sampleBoards) || sampleBoards < 0) throw new RangeError("Invalid rating sample boards");
}

/** Step 5 of Glickman's Glicko-2 specification, using its Illinois root-finding procedure. */
function nextVolatility(volatility: number, deviationSquared: number, variance: number, delta: number): number {
  const logVolatilitySquared = 2 * Math.log(volatility);
  const totalVariance = deviationSquared + variance;
  const deltaSquared = delta ** 2;
  const target = (x: number) => {
    const candidate = Math.exp(x);
    return (candidate * (deltaSquared - totalVariance - candidate)) / (2 * (totalVariance + candidate) ** 2)
      - (x - logVolatilitySquared) / TAU ** 2;
  };

  let left = logVolatilitySquared;
  let right: number;
  if (deltaSquared > totalVariance) {
    right = Math.log(deltaSquared - totalVariance);
  } else {
    let step = 1;
    right = left - step * TAU;
    while (target(right) < 0 && step < VOLATILITY_ITERATION_LIMIT) {
      step++;
      right = left - step * TAU;
    }
  }
  let leftValue = target(left);
  let rightValue = target(right);
  if (!Number.isFinite(leftValue) || !Number.isFinite(rightValue) || leftValue * rightValue > 0) {
    throw new RangeError("Glicko-2 could not bracket the new volatility");
  }

  for (let iteration = 0; iteration < VOLATILITY_ITERATION_LIMIT; iteration++) {
    if (Math.abs(right - left) <= TOLERANCE || leftValue === 0) return Math.exp(left / 2);
    if (rightValue === 0) return Math.exp(right / 2);
    const next = left + (left - right) * leftValue / (rightValue - leftValue);
    const nextValue = target(next);
    if (nextValue * rightValue <= 0) {
      left = right;
      leftValue = rightValue;
    } else {
      leftValue /= 2;
    }
    right = next;
    rightValue = nextValue;
  }
  throw new RangeError("Glicko-2 volatility did not converge");
}

function updateRating(
  state: RatingState, observations: readonly RatedObservation[], ratings: ReadonlyMap<string, RatingState>
): RatingParameters {
  const { rating, deviation, volatility } = state;
  if (observations.length === 0) return { rating, deviation: Math.hypot(deviation, SCALE * volatility), volatility };

  const deviationSquared = (deviation / SCALE) ** 2;
  let information = 0;
  let outcomeSum = 0;
  for (const observation of observations) {
    const opponent = observation.opponentRating ?? ratings.get(observation.opponentId) ?? UNRATED;
    const opponentDeviation = opponent.deviation / SCALE;
    const weight = 1 / Math.sqrt(1 + 3 * (opponentDeviation / Math.PI) ** 2);
    const difference = (rating - opponent.rating) / SCALE;
    const expected = 1 / (1 + Math.exp(-weight * difference));
    information += weight ** 2 * expected * (1 - expected);
    outcomeSum += weight * (observation.fractionalScore - expected);
  }

  const variance = 1 / information;
  const updatedVolatility = nextVolatility(volatility, deviationSquared, variance, variance * outcomeSum);
  const updatedVariance = 1 / (1 / (deviationSquared + updatedVolatility ** 2) + information);
  return {
    rating: rating + SCALE * updatedVariance * outcomeSum,
    deviation: SCALE * Math.sqrt(updatedVariance),
    volatility: updatedVolatility
  };
}

/** Update each competitor against pre-period ratings. Callers supply each attributed observation explicitly. */
export function ratingPeriodUpdate(
  ratings: ReadonlyMap<string, RatingState>, periodResults: readonly RatingPeriodObservation[],
  algorithmVersion: RatingAlgorithmVersion, transform: RatingScoreTransform
): RatingPeriodResult {
  if (algorithmVersion !== GLICKO_2_VERSION) throw new RangeError("Unsupported benchmark rating algorithm version");
  const scoreTransformVersion = transform?.version;
  if (typeof scoreTransformVersion !== "string" || scoreTransformVersion.trim() === "" || typeof transform.toFractionalScore !== "function") {
    throw new RangeError("A versioned benchmark score transform is required");
  }

  const byCompetitor = new Map<string, RatedObservation[]>();
  for (const [id, state] of ratings) {
    if (typeof id !== "string" || id.trim() === "") throw new RangeError("A benchmark competitor ID is required");
    validateRating(state);
    byCompetitor.set(id, []);
  }
  const observations = periodResults.map((result) => {
    const { competitorId, opponentId, sampleBoards, rawScore } = result;
    if (typeof competitorId !== "string" || competitorId.trim() === "") throw new RangeError("A benchmark competitor ID is required");
    if (typeof opponentId !== "string" || opponentId.trim() === "" || competitorId === opponentId) {
      throw new RangeError("A distinct benchmark opponent ID is required");
    }
    if (!Number.isSafeInteger(sampleBoards) || sampleBoards < 1) throw new RangeError("An observation requires positive sample boards");
    if (result.opponentRating) validateRating({ ...UNRATED, ...result.opponentRating });
    validateScore(rawScore);
    const score = Object.freeze({ ...rawScore, matchpoints: Object.freeze({ ...rawScore.matchpoints }) });
    const fractionalScore = transform.toFractionalScore(score, sampleBoards);
    if (!Number.isFinite(fractionalScore) || fractionalScore < 0 || fractionalScore > 1) {
      throw new RangeError("The benchmark transform must return a fractional score between 0 and 1");
    }
    const observation = Object.freeze({ competitorId, opponentId, ...(result.opponentRating ? { opponentRating: Object.freeze({ ...result.opponentRating }) } : {}),
      sampleBoards, rawScore: score, fractionalScore });
    const matches = byCompetitor.get(competitorId);
    if (matches) matches.push(observation);
    else byCompetitor.set(competitorId, [observation]);
    return observation;
  });

  const snapshots = [...byCompetitor].map(([competitorId, matches]): RatingSnapshot => {
    const state = ratings.get(competitorId) ?? UNRATED;
    const sampleBoards = matches.reduce((total, match) => total + match.sampleBoards, state.sampleBoards);
    const updated = { ...updateRating(state, matches, ratings), sampleBoards };
    validateRating(updated);
    return Object.freeze({ competitorId, ...updated, eligible: isLeaderboardEligible(updated) });
  });
  return Object.freeze({
    algorithmVersion,
    scoreTransformVersion,
    ratings: Object.freeze(snapshots),
    observations: Object.freeze(observations)
  });
}
