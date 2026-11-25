import { BOT_CHARACTERS, botCharacter } from "@contractplay/bots";
import type { SkillLevel } from "@contractplay/core";
import { partnerSummary, type PartnerStats } from "../partnerResults.js";
import { CAST_ROLES, type BotCast, type CastRole } from "../soloSetup.js";
import { aggressionNames } from "./labels.js";

const roleNames: Record<CastRole, string> = { partner: "Partner", left: "Left opponent", right: "Right opponent" };
const skillNames: Record<SkillLevel, string> = { beginner: "Beginner", intermediate: "Intermediate", advanced: "Advanced", expert: "Expert" };
const skills: readonly SkillLevel[] = ["beginner", "intermediate", "advanced", "expert"];

/** The cast, grouped by skill level, with a custom bot first. */
const castOptions = <>
  <option value="custom">Custom bot</option>
  {skills.map((skill) => <optgroup key={skill} label={skillNames[skill]}>
    {BOT_CHARACTERS.filter((character) => character.skill === skill).map((character) =>
      <option key={character.id} value={character.id}>{character.name} · {aggressionNames[character.aggression]}</option>)}
  </optgroup>)}
</>;

/**
 * One pick per seat around the player, each a named bot character or a custom bot, with the chosen characters' blurbs
 * and, for the partner, your results together so far.
 */
export function BotCastFields({ cast, onChange, stats }: { cast: BotCast; onChange(next: BotCast): void; stats?: readonly PartnerStats[] | undefined }) {
  const chosen = CAST_ROLES.flatMap((role) => { const character = botCharacter(cast[role]); return character ? [{ role, character }] : []; });
  return <>
    {CAST_ROLES.map((role) => <label key={role}>{roleNames[role]}<select aria-label={roleNames[role]} value={cast[role]}
      onChange={(event) => onChange({ ...cast, [role]: event.target.value })}>{castOptions}</select></label>)}
    {chosen.length ? <ul className="bot-cast-blurbs quiet-copy" aria-label="Your bots">
      {chosen.map(({ role, character }) => <li key={role}><strong>{character.name}</strong> ({skillNames[character.skill]}): {character.blurb}{role === "partner" && stats
        ? <span className="partner-record"> {partnerSummary(stats.find((entry) => entry.partner === character.id))}.</span> : null}</li>)}
    </ul> : null}
  </>;
}
