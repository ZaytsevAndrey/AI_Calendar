# Voice fix flow

The old `parseTask` create-eval log and harness are removed. Live voice tests are the planner dialogue corpus in [voice-agent-dialogue-test-plan.md](voice-agent-dialogue-test-plan.md) (`npm run voice:eval:dialogue`).

A write turn returns `confirm` and the Companion panel shows a preview card until Apply or spoken yes. After Apply the card stays with a status.
