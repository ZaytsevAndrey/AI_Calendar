# Roadmap

Live queue only. Shipped work is in [roadmap archive](roadmap-archive.md). Product behavior: [overview](overview.md).

**How we work:** one chat = **one feature** below (top open item, or name it). Say *«давай наступну фічу»* / *«next feature»*. Finish → **delete that item from this file** and add a short done note to the archive. This file stays open work only. Do not leave `[x]` lines here.

**Product pillars (Oct 2026 rebuild):** the two features that define the product are **auto-scheduling** and the **voice agent**. Auto-scheduling is the base; the agent is the differentiator. Do not polish TTS / deploy variants until both pillars are trustworthy. Specs: [spec-incremental-placement.md](spec-incremental-placement.md), [spec-conflict-rules.md](spec-conflict-rules.md), [spec-voice-agent.md](spec-voice-agent.md), [voice-prompt-next.md](voice-prompt-next.md).

**Voice engine.** `POST /voice/turn` runs the structured pipeline (`StructuredVoiceService`): interpret → resolve authorized entities → preview → explicit confirm → client Apply → outcome report. `VOICE_TURN_ENGINE=legacy` switches back to the old planner (`buildPlannerSystemPrompt`). Voice MVP work is §39–§43 below; finish this pipeline, do not redesign it.

**Scheduling Domain stabilization: implementation completed and integrated, with documented residual risks and external release checks outstanding.** Branch `stabilize/scheduling` (placement engine refactor, durable jobs, locks and leases, transactional Google outbox, create idempotency, versioned migrations, the Oct 2026 audit AUD-001…AUD-027 / H-1…H-5 fixed with regression tests) is integrated into `master`. Still open: release gates G-1…G-6 below, residual risks KI-20…KI-29 ([security-and-residual-risks.md](security-and-residual-risks.md), [known-issues.md](known-issues.md)). Architecture: [placement-engine.md](placement-engine.md).

**Development priority (30 Oct 2026):** 1) complete the Voice Agent MVP — plan and phases V1–V9 in [voice-agent-roadmap.md](voice-agent-roadmap.md), every task with acceptance criteria and the open decisions D-01…D-11 in [voice-agent-backlog.md](voice-agent-backlog.md); the next slice is V1 (VC-01, VC-13, VC-14, VC-06) and §39's live run is phase V7, after the contract fixes (§39–§43 below are the product-level items the plan details); 2) validate end-to-end assistant workflows; 3) resolve the deferred hardening and the production release gates (section "After Voice MVP" below); 4) prepare a controlled release. This orders development work only: no production service is exposed to real users before the release gates are met or explicitly accepted.

---

## Now (ordered)

Do in order unless you explicitly skip ahead. These items need no outside service and no open product decision. Web only. The full mobile version is part of **§71**.

### 39. Voice MVP: check P0 on a live model and a real calendar

P0 (bulk selection, provider events, recurrence scope, time semantics, same-request dependencies) is in on branch `voice-mvp-p0`, covered by offline tests only.

- [ ] Run the P0 flows through `/voice/turn` with the live model and a real Google calendar. Fix what breaks.
- [ ] Replay the 29 Oct log dialogues (day plan with Later tasks, plan edits, rename / delete of a calendar event, done on an event, agenda latency). The prompt changed: plan items carry ids, Later tasks are a separate list, an agreed clock stays a clock.
- [ ] Agenda: one cold provider read can still take about 5 s. Measure after the parallel-read change.
- Known gaps, by decision: a task with several slots is not moved (the engine does not split yet). Ordering after a new task with no clock asks for the predecessor instead of guessing.

### 40. Voice MVP: preference profile

- [ ] Reuse existing user settings first (wake/sleep, phases, default duration).
- [ ] Voice "remember that …" saves a preference only after a confirm. Preferences are soft constraints for placement and day plans, never an entity id.

### 41. Voice MVP: bounded context

- [ ] Stop putting every open record in the prompt. Give the model targeted read / search tools instead.
- [ ] Measure tokens, cost, and latency per turn without logging raw content.

### 42. Voice MVP: hardening

- [ ] Etag / revision preconditions on Apply.
- [ ] Session store shared across instances, or run a single instance.
- [ ] Idempotent Apply; reconcile an unknown outcome instead of writing twice.
- [ ] A lint command that runs. Fix the known `WorldName` typecheck error.

### 43. Voice MVP: polish

- [ ] Shorter clarifications.
- [ ] Preview shows a before → after diff.
- [ ] Day planning uses the preferences from §40.
- [ ] Fast create skips the preview only under an explicit confirmation policy.

### 37. Diagnose duplicate / excess fetches

Network looks busy: the same resources seem to refetch too often (calendar events, tasks, settings, habits, and similar).

- [ ] Trace Network / RTK Query / axios on Calendar, Tasks, and Settings: which endpoints fire, how often, and what triggers them (mount, focus, invalidation, polling, overlapping hooks).
- [ ] Write down the duplicate clusters and the smallest fix list (shared cache key, skip duplicate subscribers, tighter invalidation, debounce). Do not rewrite fetching until that note exists.

### 38. Move / place a task into the past

Dragging or saving a task onto a past clock is inconsistent or wrong. Rules already exist in places (voice normalize drops past preferred/fixed slots; placement and drag may differ).

- [ ] Research what today allows or blocks: drag / resize, form edit, `POST /schedule/move-event`, create/placement, voice. Note specs and code paths that disagree.
- [ ] Decide the product rule (block, warn, allow within today, allow completed history, etc.), then implement that one rule everywhere. Do not patch one surface alone.

---

### 71. Design system and mobile version

Plan: [design/design-fix-plan.md](design/design-fix-plan.md). Audit: [design/design-audit.md](design/design-audit.md). Spec: [design/design-system.md](design/design-system.md).

Decided: phases move into Settings → «Мій день»; font Onest; phase colors only from the 10-color palette (existing colors mapped to the nearest); the full mobile version (old §32) is in this item. Stages 0–6 and most mobile steps are shipped (archive).

- [ ] Stage 7 — mobile version, steps M0–M8 in [design/mobile-plan.md](design/mobile-plan.md): sheets instead of popovers, TimeWheel / DateStrip pickers, Today bar + sheet, shared slot sheet for Problematic and Later, swipe rows, full-width tab bar.

---

## Later — decide before building

Do not start these. The shape is still open.

- **§31 Database backup.** After production moves to a paid host. Free Neon keeps about six hours of history and has no backup schedule; Render’s disk is ephemeral and Render Cron is paid. The SQLite copy script still wipes production tables before it writes. Do not build a homegrown dump on this free stack. When the paid service is chosen: a scheduled Postgres copy and a restore that has been run once.
- **§24 Personal-computer build, then local TTS.** Deferred from Now — do after the rest of Now. Handoff: [tts-local.md](tts-local.md). en/uk only. Other languages are [end of queue](#end--external-do-not-start). Build/run variant for a personal computer (stays awake; not the Render free service); on that build only: one Piper HTTP process, voice per request (`uk` Тетяна, `en` Lessac), behind `VoiceSpeech.speak()`.
- **Habits.** Soft-disabled for MVP (no UI/nav/voice/schedule/reminders impact; DB rows and Google habit events left as-is). Re-enable only after we decide what habits should become.
- **Languages beyond en/uk.** UI and speech are en and uk. Pick the set before adding catalogs.
- **STT language: auto vs settings.** Today `speechLanguage` (`en` | `uk`) is a hint to Whisper on `/voice/transcribe`, and the Azure Speech test path sends the same setting as `uk-UA` or `en-US`. Investigate whether Whisper already detects the spoken language well enough without that setting, whether a wrong hint hurts accuracy, and whether Settings still needs an explicit speech language (or auto / follow-UI is enough). Decide before changing Settings or the STT call.
- **Hide app calendar.** Visibility toggle for the app-owned calendar — product nuances still open.
- **Outbound sync beyond Google.** Settings stores `syncTargetCalendars`, but app-task create/update/delete still writes Google only. Do not start until that write path is the task.
- **Invite to an event (large).** Add someone to an event. Likely **per calendar provider** (Google / Microsoft / Apple differ on attendees, contact pickers, and OAuth scopes). Before any build: investigate whether we can read contacts at all; design the flow when contacts permission is denied (manual email? paste? skip?); decide where invite lives (preview, editor, voice); agree RSVP / attendees UI. Needs a dedicated product discussion — do not start from a thin ticket.
- **Learned preference profile (large).** Beyond §40: infer durable facts from the schedule itself and feed Suggestions too. Examples: avoid heavy work on days packed with meetings; commute home is ~40 minutes unless they stop somewhere. Before build: what is stored, who can see/edit/delete it, how often it updates, privacy vs quality. Do not start until that shape is agreed.

---

## After Voice MVP — deferred hardening and release gates

Start after the Voice MVP (§39–§43) and the end-to-end check. Order, severity and evidence: [security-and-residual-risks.md](security-and-residual-risks.md).

**Release gates — met, or accepted in writing by the owner, before real users:**

- [ ] G-1 Neon migration rehearsal on a branch of the production database; non-pooled connection if more than one instance (KI-01).
- [ ] G-2 Postgres CI job green on GitHub (KI-02).
- [ ] G-3 Manual Google Calendar check with a test account: lost insert answer, deleted event, guests and Meet kept, disconnect and sign in again, DST series (KI-03).
- [ ] G-4 Security: ownership and mass-assignment review plus request validation for the controllers outside scheduling, with two-user e2e tests (KI-24).
- [ ] G-5 Security: encrypt stored OAuth tokens and hash the app refresh token (KI-28).
- [ ] G-6 Voice rollout gates, if voice ships: live quality, Apply preconditions, shared session store (KI-04, KI-19, §42).

**Deferred hardening (not release-blocking):**

- [ ] Validate the task status body (KI-27).
- [ ] Habits and day reminders on the Google queue (KI-12).
- [ ] Google ETag preconditions and incremental sync (KI-05, KI-06, KI-23).
- [ ] Placement: `placed` mark inside the placement transaction (KI-20), one transaction per placement (KI-22), hole refill on a job (KI-16).
- [ ] Lock timeout as 503 (KI-25); shared Google connection-state cache (KI-15).
- [ ] Series: creation on a DST day at a non-existent clock (KI-21); `parentSeriesId` after re-merge (KI-26).
- [ ] Repository wrapper for criteria writes (KI-07); remove unused code and undo columns (KI-17).
- [ ] Account deletion without a Google grant: tell the user (KI-29).

---

## End — external, do not start

Third parties and publishing. Leave these until the Now list is done.

- **Payments.** Trial, subscription, and a payment provider. This is what replaces the free voice daily token cap.
- **Privacy policy and Google consent.** A public policy URL, then move the consent screen out of testing so people other than listed test users can sign in.
- **Custom domain.**
- **Next.js landing and lead capture.**
- **Speech for languages other than en/uk.**
- **More calendar providers** beyond Google / Microsoft / Apple.
- **Research only — push subscriptions for calendar updates.** Google Calendar push (watch / channels) and Microsoft Graph change notifications. Decide whether we need them at all versus poll / fetch-on-open. Do not build until that research says yes.

---

## Out of scope (this roadmap)

- Habitica-style RPG / social leaderboards.
- Rewriting STT / mic capture from scratch.
- Restoring priority-based displacement as the main scheduler rule.
- Competing with Motion/Reclaim on scheduling polish alone (agent quality and trustworthy seating come first).

---

## Recommended next steps

1. Next: the Voice Agent plan in [voice-agent-roadmap.md](voice-agent-roadmap.md) — phase **V1** (scheduling-contract fixes VC-01, VC-13, VC-14, VC-06) first; **§39**'s live run on a real calendar is phase V7, after the fixes; §40–§43 follow the phase order there. **§37** fetches and **§38** past placement are independent web items. **§71** design system and mobile version is independent web work; next is the rest of its stage 7 (mobile pass over every screen). (§31 backup and §24 Piper are in Later.)
2. Old planner prompt work ([voice-prompt-next.md](voice-prompt-next.md), Planner C2 / C3) stays with the legacy engine. Do not put it back in this queue.
3. After each feature ships: delete that item from this file, add a one-liner in [roadmap-archive.md](roadmap-archive.md), update [overview.md](overview.md) / API docs if behavior changed.
