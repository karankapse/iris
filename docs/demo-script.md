# Demo script (about 5 minutes)

Goal: show that Iris lets someone communicate with only their eyes, and that the voice carries emotion.

## Before you start
- `make dev`, open http://localhost:5173 in **Chrome**, allow camera and microphone.
- Sit at a normal distance with good, even light on your face. Click **Calibrate** once (about 40 s).
- Open `http://localhost:5173/partner` in a second window (the partner's view).
- No hardware? Set the mocks in `.env` (see README) and use the keyboard as your eyes.

## The story
1. **The problem (30 s).** Standard AAC voices are flat: "I love you" and "I'm in pain" sound identical.
2. **The partner speaks (30 s).** Say "Are you hungry?" (or type it). It appears on both screens.
3. **Reply with the eyes (60 s).** Options sit in the four corners. Look at one: it lights up and a bar fills; or blink deliberately. Point out: max 4 options, big targets, nothing is chosen while you look at the middle.
4. **Tone, with the user in charge (60 s).** The app suggests a tone (from the mood, the face, or Claude). One glance accepts it; "Change tone" offers the others. Point out: **it never speaks without confirmation.**
5. **Hear the difference (30 s).** Open `/tone-tester` and play one sentence in every tone.
6. **Feedback (30 s).** Answer "was the tone right?" with your eyes; the partner taps 👍/🤔 in the partner view. These labels retrain *this person's* emotion model.
7. **Low effort (30 s).** Show quick phrases ("I need help"), the eye keyboard, and the persistent mood so no tone has to be picked each time.
8. **Adjustable (30 s).** Menu → Settings: dwell time, blink length, steadiness, speech speed. Abilities change, so nothing is fixed.

## If something goes wrong
- Gaze feels off: re-run **Calibrate**, keep your head still, improve the light.
- Mic not hearing: check the "Microphone" panel in the Menu; type what the partner says instead.
- No sound: check the tab isn't muted; the voice starts after a keypress or click.
