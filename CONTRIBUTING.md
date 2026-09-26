# Contributing to Iris

There are four of us, each owning one module. These rules keep us from breaking each other's work.

## The workflow in short

1. Pick (or create) an issue. Comment that you're taking it.
2. Branch from an up-to-date `main`.
3. Commit small, with clear messages.
4. Open a pull request. **At least one teammate must approve** before it merges.
5. Squash-merge, delete the branch.

`main` is protected: nobody pushes to it directly, including the owner.

## Branch names

`<type>/<module>-<short-description>`, lowercase, words separated by hyphens.

| Type | Use for | Example |
|---|---|---|
| `feature/` | new functionality | `feature/eye-input-blink-detection` |
| `fix/` | bug fixes | `fix/voice-ui-tts-overlap` |
| `docs/` | documentation only | `docs/architecture-face-tracker` |
| `chore/` | tooling, CI, dependencies | `chore/ci-cache-npm` |

Module names: `eye-input`, `emotion`, `conversation-ai`, `voice-ui` (or `shared` for cross-cutting work).

```bash
git switch main && git pull
git switch -c feature/eye-input-blink-detection
```

## Commit messages

[Conventional Commits](https://www.conventionalcommits.org/) with the module as the scope:

```
<type>(<module>): <what changed, in the imperative, under ~70 characters>

Optional body: WHY you made the change, if it isn't obvious.
```

Types: `feat`, `fix`, `docs`, `test`, `refactor`, `chore`.

```
feat(eye-input): detect deliberate blinks longer than 400 ms
fix(voice-ui): cancel previous utterance before speaking
test(emotion): cover softmax prediction with a hand-made model
```

## Pull requests

- Keep them small: one idea per PR is much easier to review.
- Fill in the PR template. Link the issue (`Closes #12`).
- CI must be green: lint, formatting, types, and tests for both frontend and backend.
- **Review** within a day if you can. Approve when you understand the change and would be happy to
  maintain it; leave comments and questions freely, we're all learning.
- Resolve every review conversation before merging. Use "Squash and merge".
- Your PR should keep the app runnable **with mocks** so others can pull it without hardware.

## Shared interfaces: extra care

`frontend/src/contracts/*` and `backend/app/schemas/*` are the agreements between modules.
If you change one:

1. Say so clearly in the PR description and tag the affected module owners.
2. Backend schemas: run `make gen-types` and commit `backend/openapi.json` and
   `frontend/src/shared/api.generated.ts` (CI fails if they're stale).
3. Update the mock **and** the real implementation, or the app won't compile.

Prefer *adding* optional fields over changing or removing existing ones.

## Local checks before you push

```bash
make format
make lint
make test
```

- **Frontend:** ESLint + Prettier + TypeScript strict mode, tests with Vitest.
- **Backend:** Ruff (lint + format), tests with pytest.

Write a test for logic that can be tested without a camera: state machines, math, parsing, API routes.

## Rules that protect the user

- **Never commit secrets.** API keys go in `.env` (git-ignored). Only edit `.env.example` for placeholders.
- **Never store or upload raw video or audio**, and never commit images or recordings of faces. We
  only keep numeric features and labels.
- **The app must never speak without the user's confirmation.** The state machine
  (`frontend/src/app/machine.ts`) enforces this and has tests. Keep it that way.
- Keep targets big, options to 4 or fewer, and interactions short: eye control is tiring.

## Code style

Write for a teammate who joined last week: descriptive names, comments that explain *why*, and no
clever tricks. Match the style of the file you're editing.
