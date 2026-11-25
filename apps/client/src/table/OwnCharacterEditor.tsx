import { TRAIT_LEVELS, TRAIT_NAMES, type SkillLevel } from "@contractplay/core";
import { MAX_CHARACTER_BLURB, MAX_CHARACTER_NAME, type OwnCharacter } from "@contractplay/persistence";
import { useId, useState } from "react";
import { checkDraft, startingPoints, type CharacterDraft } from "../ownCharacters.js";
import { skillNames, traitWords } from "./labels.js";

const skills = Object.keys(skillNames) as SkillLevel[];

/**
 * A form for one of the player's own characters: name, description, skill, and a setting on each trait dial with what it
 * means. A new character can start from a preset or a copy of a cast member.
 */
export function OwnCharacterEditor({ initial, onSave, onCancel }: { initial?: OwnCharacter | undefined; onSave(draft: CharacterDraft): void; onCancel(): void }) {
  const id = useId();
  const [draft, setDraft] = useState<CharacterDraft>(() => initial
    ? { name: initial.name, blurb: initial.blurb, skill: initial.skill, traits: initial.traits }
    : startingPoints[0]!.draft);
  const [error, setError] = useState<string>();
  const save = () => {
    const checked = checkDraft(draft);
    if ("error" in checked) setError(checked.error);
    else onSave(checked.draft);
  };
  // A group, not a form: it sits inside the lobby's Play form.
  // Enter saves the character, rather than submitting the lobby's Play form around the editor.
  const saveOnEnter = (event: { key: string; preventDefault(): void }) => { if (event.key === "Enter") { event.preventDefault(); save(); } };
  return <div className="own-character-editor" role="group" aria-label={initial ? `Edit ${initial.name}` : "New character"}>
    {initial ? null : <label>Start from<select defaultValue="" onChange={(event) => {
      const point = startingPoints.find((entry) => entry.label === event.target.value);
      if (point) setDraft({ ...point.draft, traits: { ...point.draft.traits } });
    }}><option value="" disabled>Choose…</option>{startingPoints.map((point) => <option key={point.label} value={point.label}>{point.label}</option>)}</select></label>}
    <label>Name<input value={draft.name} onKeyDown={saveOnEnter} maxLength={MAX_CHARACTER_NAME * 2} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
    <label>Description<input value={draft.blurb} onKeyDown={saveOnEnter} maxLength={MAX_CHARACTER_BLURB * 2} onChange={(event) => setDraft({ ...draft, blurb: event.target.value })} /></label>
    <label>Skill<select value={draft.skill} onChange={(event) => setDraft({ ...draft, skill: event.target.value as SkillLevel })}>
      {skills.map((skill) => <option key={skill} value={skill}>{skillNames[skill]}</option>)}</select></label>
    {TRAIT_NAMES.map((name) => <fieldset key={name} className="trait-dial">
      <legend>{traitWords[name].label}</legend>
      {TRAIT_LEVELS.map((level) => <label key={level}><input type="radio" name={`${id}-${name}`} value={level} checked={draft.traits[name] === level}
        onChange={() => setDraft({ ...draft, traits: { ...draft.traits, [name]: level } })} />{traitWords[name].levels[level].word}</label>)}
      <p className="quiet-copy">{traitWords[name].levels[draft.traits[name]].meaning}</p>
    </fieldset>)}
    {error ? <p role="alert" className="form-error">{error}</p> : null}
    <div className="own-character-actions"><button type="button" onClick={save}>Save</button><button type="button" className="secondary-button" onClick={onCancel}>Cancel</button></div>
  </div>;
}
