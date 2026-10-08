# AI Calendar Assistant documentation

Single source of truth for the project. Keep these files in sync with code changes.

| Document | Contents |
|----------|----------|
| [Project overview](overview.md) | Purpose, stack, modules, user flow, repo layout |
| [Setup and build](setup-and-build.md) | Dependencies, environment variables, ports, npm commands (root / frontend / backend) |
| [API reference](api-reference.md) | Main HTTP routes (aligned with Nest controllers) |
| [Integrations](integrations.md) | Google OAuth / Calendar, Groq voice, common errors (`redirect_uri_mismatch`) |
| [Deploy](deploy.md) | Free hosting on Render + Neon, GitHub Actions CI, `master` auto-deploy |
| [Task creation rules](task-creation-rules.md) | Presets vs settings, validation, phase, recurrence weekdays, Google sync |
| [Roadmap](roadmap.md) | Live queue |
| [Roadmap archive](roadmap-archive.md) | Shipped work |
| [Spec: Incremental placement](spec-incremental-placement.md) | Who is read and written per calendar edit. No Generate button. A displaced day becomes a new task; a chain runs only when everyone still fits (target; engine still full-replans) |
| [Spec: Conflict rules](spec-conflict-rules.md) | Unscheduled vs Problematic, conflict option ids; who moves defers to incremental placement |
| [Spec: Voice Commander](spec-voice-commander.md) | Full task/habit CRUD by voice, TTS, mic equalizer, confirm delete/cancel (roadmap §13) |
| [Spec: Intelligent scheduling](spec-intelligent-scheduling.md) | Unified items, settings, phases, queue, diff/undo, Google anchors (defers placement to conflict rules) |
| [Task scheduling test matrix](task-scheduling-test-matrix.md) | Given/When/Then cases mapped to unit tests |
| [E2E test coverage plan](e2e-test-coverage.md) | All live API/UI cases and edge cases, layers, P0 smoke, implementation waves |

**Swagger (live schema):** after starting the backend — `http://localhost:3001/api` (if `PORT` is unchanged).

**Last documentation update:** October 2026 (Unscheduled inbox cards: icon meta + overdue; Generate removed).
