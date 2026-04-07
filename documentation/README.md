# AI Calendar Assistant documentation

Single source of truth for the project. Keep these files in sync with code changes.

| Document | Contents |
|----------|----------|
| [Project overview](overview.md) | Purpose, stack, modules, user flow, repo layout |
| [Setup and build](setup-and-build.md) | Dependencies, environment variables, ports, npm commands (root / frontend / backend) |
| [API reference](api-reference.md) | Main HTTP routes (aligned with Nest controllers) |
| [Integrations](integrations.md) | Google OAuth / Calendar, common errors (`redirect_uri_mismatch`) |
| [Roadmap](roadmap.md) | Done, in progress, planned |
| [Spec: Intelligent scheduling](spec-intelligent-scheduling.md) | Unified items, types, phases, queue, diff/undo, Google anchors |

**Swagger (live schema):** after starting the backend — `http://localhost:3001/api` (if `PORT` is unchanged).

**Last documentation update:** April 2026 (aligned with intelligent scheduling, per-user phases, Schedule UI diff/undo, integrations note for Google on undo).
