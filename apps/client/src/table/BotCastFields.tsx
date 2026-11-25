import { BOT_CHARACTERS } from "@contractplay/bots";
import type { SkillLevel } from "@contractplay/core";
import { MAX_OWN_CHARACTERS, type OwnCharacter } from "@contractplay/persistence";
import { useState } from "react";
import { createCharacter, deleteCharacter, liveCharacters, rosterCharacter, updateCharacter } from "../ownCharacters.js";
import { editedNote, opponentSummary, partnerSummary, type OpponentStats, type PartnerResult, type PartnerStats } from "../partnerResults.js";
import { CAST_ROLES, type BotCast, type CastRole } from "../soloSetup.js";
import { aggressionNames } from "./labels.js";
import { OwnCharacterEditor } from "./OwnCharacterEditor.js";

const roleNames: Record<CastRole, string> = { partner: "Partner", left: "Left opponent", right: "Right opponent" };
const skillNames: Record<SkillLevel, string> = { beginner: "Beginner", intermediate: "Intermediate", advanced: "Advanced", expert: "Expert" };
const skills: readonly SkillLevel[] = ["beginner", "intermediate", "advanced", "expert"];

/** The cast, grouped by skill level, with a custom bot first and the player's own characters after it. */
const castOptions = (own: readonly OwnCharacter[]) => <>
  <option value="custom">Custom bot</option>
  {own.length ? <optgroup label="Your characters">{own.map((character) =>
    <option key={character.id} value={character.id}>{character.name} · Your character</option>)}</optgroup> : null}
  {skills.map((skill) => <optgroup key={skill} label={skillNames[skill]}>
    {BOT_CHARACTERS.filter((character) => character.skill === skill).map((character) =>
      <option key={character.id} value={character.id}>{character.name} · {aggressionNames[character.aggression]}</option>)}
  </optgroup>)}
</>;

/**
 * One pick per seat around the player, each a named bot character or a custom bot, with the chosen characters' blurbs
 * and your results so far: together with the partner, against each opponent.
 */
export type CastRecords = Readonly<{ partners: readonly PartnerStats[]; opponents: readonly OpponentStats[]; results: readonly PartnerResult[] }>;

export function BotCastFields({ cast, onChange, records, own = [], onOwnChange, initialEditing }: { cast: BotCast; onChange(next: BotCast): void;
  records?: CastRecords | undefined; own?: readonly OwnCharacter[]; onOwnChange?: ((next: OwnCharacter[]) => void) | undefined;
  /** Open the editor on this character (or "new") from the start, as a preview does. */
  initialEditing?: string | undefined }) {
  const [editing, setEditing] = useState<string | undefined>(initialEditing);
  const live = liveCharacters(own);
  const chosen = CAST_ROLES.flatMap((role) => { const character = rosterCharacter(cast[role], own); return character ? [{ role, character }] : []; });
  // A seat whose character this device doesn't hold plays as the custom bot, and the picker says so.
  const shown = (choice: string) => choice === "custom" || rosterCharacter(choice, own) ? choice : "custom";
  const remove = (character: OwnCharacter) => {
    if (!window.confirm(`Delete ${character.name}? Its results stay in your record.`)) return;
    onOwnChange?.(deleteCharacter(own, character.id, Date.now()));
    if (CAST_ROLES.some((role) => cast[role] === character.id)) {
      onChange(Object.fromEntries(CAST_ROLES.map((role) => [role, cast[role] === character.id ? "custom" : cast[role]])) as BotCast);
    }
  };
  const full = live.length >= MAX_OWN_CHARACTERS;
  return <>
    {CAST_ROLES.map((role) => <label key={role}>{roleNames[role]}<select aria-label={roleNames[role]} value={shown(cast[role])}
      onChange={(event) => onChange({ ...cast, [role]: event.target.value })}>{castOptions(live)}</select></label>)}
    {chosen.length ? <ul className="bot-cast-blurbs quiet-copy" aria-label="Your bots">
      {chosen.map(({ role, character }) => <li key={role}><strong>{character.name}</strong> ({skillNames[character.skill]}){character.blurb ? `: ${character.blurb}` : ""}{records
        ? <span className="partner-record"> {role === "partner"
          ? partnerSummary(records.partners.find((entry) => entry.partner === character.id))
          : opponentSummary(records.opponents.find((entry) => entry.opponent === character.id))}{editedNote(character.id, own, records.results)}.</span> : null}</li>)}
    </ul> : null}
    {onOwnChange ? <section className="own-characters">
      <h3>Your characters</h3>
      {live.length ? <ul aria-label="Your characters">{live.map((character) => <li key={character.id}>
        <strong>{character.name}</strong> ({skillNames[character.skill]})
        <button type="button" className="secondary-button" aria-label={`Edit ${character.name}`} onClick={() => setEditing(character.id)}>Edit</button>
        <button type="button" className="secondary-button" aria-label={`Delete ${character.name}`} onClick={() => remove(character)}>Delete</button>
      </li>)}</ul> : <p className="quiet-copy">Make your own bots: a name, a skill, and how they bid and play.</p>}
      {editing ? <OwnCharacterEditor key={editing} initial={live.find((character) => character.id === editing)} onCancel={() => setEditing(undefined)}
        onSave={(draft) => {
          onOwnChange(editing === "new" ? createCharacter(own, draft, Date.now()) : updateCharacter(own, editing, draft, Date.now()));
          setEditing(undefined);
        }} /> : <>
        <button type="button" disabled={full} onClick={() => setEditing("new")}>New character</button>
        {full ? <p className="quiet-copy">You have {MAX_OWN_CHARACTERS} characters, the most you can keep.</p> : null}
      </>}
    </section> : null}
  </>;
}
