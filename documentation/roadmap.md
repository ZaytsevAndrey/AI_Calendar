# Roadmap

Live queue only. Shipped work is in [roadmap archive](roadmap-archive.md). Product behavior: [overview](overview.md).

**How we work:** one chat = **one feature** below (top open item, or name it). Say *«давай наступну фічу»* / *«next feature»*. Finish → **delete that item from this file** and add a short done note to the archive. This file stays open work only. Do not leave `[x]` lines here.

**Product pillars (Oct 2026 rebuild):** the two features that define the product are **auto-scheduling** and the **voice agent**. Auto-scheduling is the base; the agent is the differentiator. Do not polish TTS / deploy variants until both pillars are trustworthy. Specs: [spec-incremental-placement.md](spec-incremental-placement.md), [spec-conflict-rules.md](spec-conflict-rules.md), [spec-voice-agent.md](spec-voice-agent.md), [voice-prompt-next.md](voice-prompt-next.md).

---

## Now (ordered)

Do in order unless you explicitly skip ahead.

### 23. Voice agent — make it understand

Handoff: [voice-prompt-next.md](voice-prompt-next.md). Specialists are full in code; behavior is not frozen.

Goal: spoken create/command lands on the right intent and when/kind tree often enough that the agent feels usable.

- [ ] Golden utterance tests for router + kind/when (and the other high-traffic intents that fail in real logs): normalize + prompt snapshot / fixture tests from real failures.
- [ ] Fix prompt or normalize bugs those fixtures expose (no new intents, no STT rewrite).
- [ ] Archive [voice-prompt-next.md](voice-prompt-next.md) when the open queue there is done.

Done when: golden set is in CI and the known log failures that seeded it pass.

### 24. Personal-computer build, then local TTS

Handoff: [tts-local.md](tts-local.md). After §23, in this order:

- [ ] Build/run variant for a personal computer (stays awake; not the Render free service).
- [ ] On that build only: one Piper HTTP process, voice per request (`uk` Тетяна, `en` Lessac), behind `VoiceSpeech.speak()`.

---

## Out of scope (this roadmap)

- Habitica-style RPG / social leaderboards.
- Rewriting STT / mic capture from scratch.
- Restoring priority-based displacement as the main scheduler rule.
- Competing with Motion/Reclaim on scheduling polish alone (agent quality and trustworthy seating come first).

---

## Recommended next steps

1. Next live item: roadmap **§23** — voice golden utterances ([voice-prompt-next.md](voice-prompt-next.md)).
2. After §23: roadmap **§24** — personal-computer build, then Piper TTS ([tts-local.md](tts-local.md)).
3. After each feature ships: delete that item from this file, add a one-liner in [roadmap-archive.md](roadmap-archive.md), update [overview.md](overview.md) / API docs if behavior changed.
