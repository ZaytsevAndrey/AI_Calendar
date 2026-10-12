# Roadmap

Live queue only. Shipped work is in [roadmap archive](roadmap-archive.md). Product behavior: [overview](overview.md).

**How we work:** one chat = **one feature** below (top open item, or name it). Say *«давай наступну фічу»* / *«next feature»*. Finish → **delete that item from this file** and add a short done note to the archive. This file stays open work only. Do not leave `[x]` lines here.

Design decisions for this queue: [spec-voice-agent.md](spec-voice-agent.md) (hybrid Voice Agent, shipped); [voice-prompt-next.md](voice-prompt-next.md) (open prompt work). Placement and conflict contracts: [spec-incremental-placement.md](spec-incremental-placement.md), [spec-conflict-rules.md](spec-conflict-rules.md).

---

## Now (ordered)

Do in order unless you explicitly skip ahead.

### 20. Voice prompts — remaining specialists

Handoff: [voice-prompt-next.md](voice-prompt-next.md). Create modules and the wake-day/sleep when rule already shipped.

- [ ] Fatten specialist stubs: `complete` / `skip` / `delete`, then habits.
- [ ] Golden utterance tests for kind/when; archive [voice-prompt-next.md](voice-prompt-next.md) when done.

---

## Out of scope (this roadmap)

- Habitica-style RPG / social leaderboards.
- Rewriting STT / mic capture from scratch.
- Restoring priority-based displacement as the main scheduler rule.

---

## Recommended next steps

1. Next live item: roadmap **§20** — fatten `complete` / `skip` / `delete` stubs ([voice-prompt-next.md](voice-prompt-next.md)).
2. After each feature ships: delete that item from this file, add a one-liner in [roadmap-archive.md](roadmap-archive.md), update [overview.md](overview.md) / API docs if behavior changed.
