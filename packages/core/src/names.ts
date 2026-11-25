const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;
/** Unicode format characters: zero-width spaces and joiners, bidirectional overrides and the like. */
const FORMAT = /\p{Cf}/gu;
/** A surrogate half not paired with its partner (with the u flag, paired halves match as one code point). */
const LONE_SURROGATE = /\p{Cs}/u;

/**
 * Removes format characters (zero-width and bidi controls), replaces control characters with spaces,
 * collapses whitespace and trims; undefined when not well-formed Unicode, empty, or longer than max.
 */
export function cleanName(value: unknown, max: number): string | undefined {
  if (typeof value !== "string" || LONE_SURROGATE.test(value)) return undefined;
  const name = value.replace(FORMAT, "").replace(CONTROL, " ").replace(/\s+/g, " ").trim();
  return name.length === 0 || [...name].length > max ? undefined : name;
}
