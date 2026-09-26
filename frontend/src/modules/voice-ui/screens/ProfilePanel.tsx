import { useState } from 'react';
import type { UserProfile } from '../../../contracts';
import type { Orchestrator } from '../../../app/Orchestrator';

const lines = (text: string) =>
  text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

/**
 * Who the user is. This makes Claude's suggestions personal (names, interests, what they often
 * need) and holds the quick-access phrases. Stored locally; a caregiver fills it in.
 */
export function ProfilePanel({
  orchestrator,
  profile,
}: {
  orchestrator: Orchestrator;
  profile: UserProfile;
}) {
  const [name, setName] = useState(profile.name);
  const [relationships, setRelationships] = useState(profile.relationships.join('\n'));
  const [interests, setInterests] = useState(profile.interests.join('\n'));
  const [needs, setNeeds] = useState(profile.common_needs.join('\n'));
  const [phrases, setPhrases] = useState(profile.phrases.join('\n'));
  const [saved, setSaved] = useState(false);

  const field = (
    label: string,
    help: string,
    value: string,
    set: (v: string) => void,
    rows = 3,
  ) => (
    <label className="field">
      <strong>{label}</strong>
      <span className="help">{help}</span>
      <textarea
        rows={rows}
        value={value}
        onChange={(e) => (set(e.target.value), setSaved(false))}
      />
    </label>
  );

  return (
    <section className="panel profile">
      <h3>About the user</h3>
      <label className="field">
        <strong>Name</strong>
        <input value={name} onChange={(e) => (setName(e.target.value), setSaved(false))} />
      </label>
      {field(
        'People in their life',
        'One per line, e.g. “daughter Maya”',
        relationships,
        setRelationships,
      )}
      {field('Interests', 'One per line', interests, setInterests)}
      {field('Things they often need', 'One per line, e.g. “water”, “pillow”', needs, setNeeds)}
      {field(
        'Quick phrases',
        'One per line. Shown under “Quick phrases” on the main screen.',
        phrases,
        setPhrases,
        6,
      )}
      <button
        onClick={async () => {
          await orchestrator.saveProfile({
            name: name.trim(),
            relationships: lines(relationships),
            interests: lines(interests),
            common_needs: lines(needs),
            phrases: lines(phrases),
          });
          setSaved(true);
        }}
      >
        Save
      </button>
      {saved && <span className="saved">Saved ✓</span>}
    </section>
  );
}
