// Picking a good browser voice. The default voice is often the robotic one; macOS has much better
// "Enhanced" / "Premium" versions of Samantha and Ava (download them in System Settings ->
// Accessibility -> Spoken Content -> System Voice -> Manage Voices).

/** Best first. Each is tried against the voice name, among en-US voices. */
const PREFERRED: RegExp[] = [
  /^Ava \((Premium|Enhanced)\)/i,
  /^Samantha \((Premium|Enhanced)\)/i,
  /\bAva\b.*(Premium|Enhanced)/i,
  /\bSamantha\b.*(Premium|Enhanced)/i,
  /(Premium|Enhanced|Natural)/i, // any other high-quality en-US voice
  /^Ava\b/i,
  /^Samantha\b/i,
  /^Google US English/i,
];

type Voice = Pick<SpeechSynthesisVoice, 'name' | 'lang' | 'localService' | 'default'>;

/** The best voice available, or null if there are none (the browser default is used then). */
export function pickVoice<V extends Voice>(voices: V[]): V | null {
  const us = voices.filter((v) => /^en[-_]US$/i.test(v.lang));
  for (const pattern of PREFERRED) {
    const hit = us.find((v) => pattern.test(v.name));
    if (hit) return hit;
  }
  return (
    us.find((v) => v.localService) ??
    us[0] ??
    voices.find((v) => /^en\b/i.test(v.lang)) ??
    voices.find((v) => v.default) ??
    voices[0] ??
    null
  );
}

/**
 * speechSynthesis.getVoices() is often EMPTY on the first call (Chrome loads voices
 * asynchronously): wait for the 'voiceschanged' event, up to `timeoutMs`.
 */
export function loadVoices(timeoutMs = 1500): Promise<SpeechSynthesisVoice[]> {
  const synth = window.speechSynthesis;
  const now = synth.getVoices();
  if (now.length) return Promise.resolve(now);
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      synth.removeEventListener('voiceschanged', done);
      resolve(synth.getVoices());
    };
    const timer = setTimeout(done, timeoutMs);
    synth.addEventListener('voiceschanged', done);
  });
}

let preferred: Promise<SpeechSynthesisVoice | null> | null = null;

/** The chosen voice, looked up once per page. */
export function preferredVoice(): Promise<SpeechSynthesisVoice | null> {
  if (!('speechSynthesis' in window)) return Promise.resolve(null);
  preferred ??= loadVoices().then((voices) => {
    const v = pickVoice(voices);
    if (!v) preferred = null; // nothing yet: try again next time
    return v;
  });
  return preferred;
}
