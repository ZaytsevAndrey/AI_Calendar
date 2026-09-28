# Roadmap

Live queue only. Shipped work is in [roadmap archive](roadmap-archive.md). Product behavior: [overview](overview.md).

**How we work:** one chat = **one feature** below (top open item, or name it). Say *«давай наступну фічу»* / *«next feature»*. Finish → check it off here and move a short done note into the archive.

Design decisions for this queue: [spec-conflict-rules.md](spec-conflict-rules.md) (type + preferred time, no priorities, conflict options, problematic ≠ unscheduled, Voice on the same layer). Habits achievements + AI streak tips are done.

---

## Now (ordered)

Do in order unless you explicitly skip ahead.

### 1. Conflict rules spec + test matrix

- [x] Short product spec: who moves silently, who asks, unscheduled vs problematic, no-reply → problematic.
- [x] Rewrite [task-scheduling-test-matrix.md](task-scheduling-test-matrix.md) for the new rules (drop priority-displacement as the primary story).

### 2. Engine: type + preferred, no priority

- [x] Placement ignores priority (field soft-deprecated).
- [x] Preferred-first for flexible; fixed stays an anchor.
- [x] Flexible silent move within phase; recurring move + notify; overflow path ready for problematic.
- [x] Unit tests for the new matrix cases that belong to the engine only.

### 3. Problematic inbox

- [x] Model/API distinct from `isUnscheduled` (fell out of schedule).
- [x] Calendar banner/chip + sheet: open task, move / skip / resolve actions.
- [x] No-answer / overflow after conflict lands here.

### 4. Shared conflict options + sheet

- [x] Structured option ids from the engine (`move_other`, `move_new`, `skip_occurrence`, …).
- [x] One UI sheet for form create and later Voice/drag.
- [x] Groq only phrases options; applying uses existing APIs.

### 5. Voice on the same decision layer

- [x] Create / reschedule after parse call the same placement + conflict builder (not a second brain).
- [x] `needs_conflict_choice` → same sheet; second utterance or tap picks an option.
- [x] Unscheduled-oriented commands: done / skip / do now (wire as far as APIs allow).
- [x] Voice unit + P1 e2e for conflict choice.

### 6. Drag → day / phase replan

- [x] After drag, replan affected phases for that civil day (A→B = both).
- [x] Flexible: silent shift if a hole exists; else conflict sheet / problematic.
- [x] Recurring instance moved → user-visible notice.

### 7. Unscheduled actions

- [x] Card actions: **Done**, **Skip**, **Do now**, **Open**.
- [x] Deadline with no fit stays Unscheduled (not problematic), with existing overdue tone.
- [x] Align Voice commands with these actions.

### 8. Recurring extend; shrink Generate

- [x] Open-ended series and/or background job to extend the local/Google window.
- [x] Generate becomes “clean up / preview”, not the way recurring stays alive.

### 9. Habits: achievements

- [x] Unlock catalog (e.g. first check-in, streak 3 / 7 / 30 / 100, clean week).
- [x] Persist `unlockedAt`; toast once; badges row on Habits.
- [x] Keep existing points/streaks.

### 10. Habits: AI streak tips

- [x] On streak thresholds (3 / 7 / 30…), Groq line from habit name/description (humor OK; light safety).
- [x] Offline fallback templates if Groq is down.
- [x] Show under streak / after check-in toast.

### 11. Problematic move: pick among free slots (visual)

- [x] **No free-form date/time picker as the main UX.** User chooses among **available slots** for that day (phase / free gaps the engine already knows).
- [x] Visual placement: the task **block spins / snaps** into a **day timeline** or **mini calendar** so the move is spatial (see where it lands), not a form.
- [x] Confirm places the one-off (or instance) and skips that series day; same outcome as current Move, clearer interaction.
- [x] Works from Problematic inbox (and ideally reuse later from conflict sheet / drag if useful).

### 12. Unscheduled inbox: more informative + functional

§7 shipped basic Done / Skip / Do now / Open. Cards still feel thin next to Problematic.

- [ ] **Richer card info** — why it is unscheduled (deadline miss / no window / user parked), deadline / earliest, phase, duration; clear overdue state.
- [ ] **Stronger actions** — schedule into a real slot (reuse §11 visual pick where it fits), edit constraints without hunting, clearer Do now / Skip outcomes.
- [ ] **Discoverability** — banner/chip or empty-state copy so Unscheduled is as obvious as Problematic when items pile up.

### Later (not blocking the queue above)

- [x] **UI language (uk / en)** — chrome and dates follow settings `language`; voice already multilingual.
- [x] Voice habit check-in.
- [x] Pixel-polish for the problematic sheet (cards + one-word Skip / Move / Edit / Resolve).

---

## Out of scope (this roadmap)

- Habitica-style RPG / social leaderboards.
- Rewriting STT / mic capture from scratch.
- Restoring priority-based displacement as the main scheduler rule.

---

## Recommended next steps

1. **§12** — Unscheduled cards: more context + stronger schedule/edit actions.
2. After each feature ships: tick above, archive a one-liner in [roadmap-archive.md](roadmap-archive.md), update [overview.md](overview.md) / API docs if behavior changed.
