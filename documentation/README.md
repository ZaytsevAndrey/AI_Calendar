# luefy documentation

Single source of truth for the project. Keep these files in sync with code changes.

| Document | Contents |
|----------|----------|
| [Project overview](overview.md) | Purpose, stack, modules, user flow, repo layout |
| [Setup and build](setup-and-build.md) | Dependencies, environment variables, ports, npm commands (root / frontend / backend) |
| [API reference](api-reference.md) | Main HTTP routes (aligned with Nest controllers) |
| [Integrations](integrations.md) | Google OAuth / Calendar, Groq voice, common errors (`redirect_uri_mismatch`) |
| [Deploy](deploy.md) | Free hosting on Render + Neon, GitHub Actions CI, `master` auto-deploy |
| [Task creation rules](task-creation-rules.md) | Presets vs settings, validation, phase, recurrence weekdays, Google sync |
| [Admin console](admin-console.md) | Owner-only app and its separate API: admin accounts (manual insert), pages, user actions, stored data |
| [Roadmap](roadmap.md) | Live queue |
| [Roadmap archive](roadmap-archive.md) | Shipped work |
| [Spec: Incremental placement](spec-incremental-placement.md) | Who is read and written per calendar edit. No Generate button. A displaced day becomes a new task; a chain runs only when everyone still fits (target; engine still full-replans) |
| [Spec: Conflict rules](spec-conflict-rules.md) | Unscheduled vs Problematic, conflict option ids; who moves defers to incremental placement |
| [Spec: Voice Commander](spec-voice-commander.md) | Superseded one-shot commander. Live contract is the Voice Agent spec |
| [Spec: Voice Agent](spec-voice-agent.md) | The only Companion product contract. Ukrainian: [spec-voice-agent.uk.md](spec-voice-agent.uk.md) |
| [Voice prompts, Ukrainian](voice-prompts.uk.md) | Reading translation of the planner, router, and specialist prompts. The model still receives English |
| [Voice agent dialogue test plan](voice-agent-dialogue-test-plan.md) | Dialogue test cycle: target day-plan contract, prompt rules, Groq pacing, simple and complex flows |
| [Companion panel](features/companion-panel.md) | Floating desktop panel, preview cards, multi-intent Apply with statuses, day-plan dialogue |
| [Voice prompts — next](voice-prompt-next.md) | Handoff for roadmap **§23** (split): logging-first, then goldens, then fixes |
| [Voice fix flow](voice-fix-flow.md) | Prompt, spec, and dialogue tests stay one sentence: list the disagreement, you choose, then spec, tests, prompt |
| [Local TTS](tts-local.md) | Azure Speech when configured; otherwise Piper on the home API (`npm run start:piper`); browser voice when both are down |
| [Spec: Intelligent scheduling](spec-intelligent-scheduling.md) | Unified items, settings, phases, queue, diff/undo, Google anchors (defers placement to conflict rules) |
| [Placement engine review](placement-engine-review.md) | Oct 2026 review: 30 defects (PE-01…PE-30), test gaps, fix order. Roadmap §50 |
| [Task scheduling test matrix](task-scheduling-test-matrix.md) | Given/When/Then cases mapped to unit tests |
| [E2E test coverage plan](e2e-test-coverage.md) | All live API/UI cases and edge cases, layers, P0 smoke, implementation waves |

**Swagger (live schema):** after starting the backend — `http://localhost:3001/api` (if `PORT` is unchanged).

**Last documentation update:** 27 October 2026. Voice contract: [spec-voice-agent.md](spec-voice-agent.md). Experimental Planner C2 is not the production planner. C3 is rejected. Record: [voice-prompt-next.md](voice-prompt-next.md).
