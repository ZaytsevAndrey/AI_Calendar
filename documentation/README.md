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
| [Roadmap](roadmap.md) | Done, in progress, planned |
| [Spec: Intelligent scheduling](spec-intelligent-scheduling.md) | Unified items, settings, phases, queue, diff/undo, Google anchors |

**Swagger (live schema):** after starting the backend — `http://localhost:3001/api` (if `PORT` is unchanged).

**Last documentation update:** September 2026 (informative type-colored toasts; settings IANA time zone; From/Until, voice + PWA, Render + Neon).
