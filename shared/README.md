# shared/

Data used by more than one part of the app, so it is written once:

- `default-phrases.json`: the quick-access phrases everyone starts with (each person can edit theirs in the app).
- `tone-voice-map.json`: how each tone (happy, sad, ...) is turned into voice settings. Read by the
  LiveKit/Cartesia agent (Python) and by the tone tester page (frontend). **Tune the voices here.**

The TypeScript types for HTTP payloads are generated from the backend's Pydantic models
(`make gen-types`), so they don't live here.
