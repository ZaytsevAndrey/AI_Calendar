# Companion panel (UI)

**Status:** shipped (UI pass)  
**Last updated:** October 2026

## What it is

Calendar **Companion** (UK: **Помічник**) replaces the old “Voice / Voice agent” chrome. Users talk or type with a helper that can answer schedule questions and propose calendar changes — without calling it AI in the UI.

## Shipped in this pass

- Rename: toolbar / settings / modal title use Companion / Помічник.
- **Desktop:** floating panel — drag header, resize edges/corners, geometry persisted in `localStorage` (`companion-panel-geometry`). Calendar underneath stays interactive (no full-screen dim).
- **Phone:** bottom sheet via existing `Modal` (no drag/resize).
- Footer actions decluttered by stage (Close + mic; Done while listening; Skip while speaking; **Apply** + Cancel on confirm; Retry on error).
- **Change preview cards** before every write and on a day plan: name, time range, duration, type badge, color stripe. One task and a batch use the same card. Nothing is saved until Apply. After Apply the card stays as **Done just now** with a status.
- Confirm responses may include `intents[]` for preview; Apply / spoken yes still applies via the server session (or local legacy confirm).

## Multi-intent and day-plan dialogue

- **Several writes in one utterance** ("buy bread, the report is done, delete milk") show one card per write and one Apply. After Apply the cards stay as **Done just now** with a status per write (Applied / Not run / Conflict / Failed); the client reports those statuses to the session (`actionId: 'report'`).
- **Day plan.** "Plan my day" opens the plan cards for that day. In the interview stage the header reads **Planning {day}** and the footer shows Cancel, mic, and **Make plan**. In review the header reads **Plan for {day}**; the footer is Cancel, mic, Apply. The mic and composer stay live, so the user edits the plan by voice or text ("drop email", "gym after 6"); each new revision marks moved or added items with a blue border and a **Changed** badge, and lists items that did not fit under **Did not fit** with a reason.
- Card type follows the item source: new task → Create, flexible task → Shift, Unscheduled task → Reschedule.
- Closing the panel discards the plan draft (the server session is deleted).
- **Mode switch** at the top of the panel: **Companion** (default) or **Fast create**. The choice is stored in `localStorage` (`companion-voice-mode`) and sent as `mode` on each turn. Fast create only changes new tasks: one phrase, at most one question when the task cannot be saved, then the same preview card and Apply. Moves, questions, and day plans stay on the Companion rules.

## Key frontend files

- `frontend/src/modules/voice/components/CompanionPanel.tsx`
- `frontend/src/modules/voice/components/ChangePreviewCards.tsx`
- `frontend/src/modules/voice/components/VoiceTaskSheet.tsx`
- `frontend/src/modules/voice/changePreviewCards.ts`
- `frontend/src/modules/voice/companionPanelGeometry.ts`
- `frontend/src/modules/voice/hooks/useVoiceTask.ts` (stages, `build_plan`, report after execute)
- `frontend/src/modules/voice/executeVoiceIntents.ts` (per-intent statuses)

Contract details: [spec-voice-agent.md](../spec-voice-agent.md).
