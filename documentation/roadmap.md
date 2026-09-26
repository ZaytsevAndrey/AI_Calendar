# Roadmap

Live queue only. Shipped work is in [roadmap archive](roadmap-archive.md). Product behavior: [overview](overview.md).

**How we work:** one chat = **one feature** below (top open item, or name it). Say *«давай наступну фічу»* / *«next feature»*. Finish → check it off here and move a short done note into the archive.

Design decisions for this queue: [spec-conflict-rules.md](spec-conflict-rules.md) (type + preferred time, no priorities, conflict options, problematic ≠ unscheduled, Voice on the same layer; habits achievements + AI tips still in the redesign plan).

---

## Now (ordered)

Do in order unless you explicitly skip ahead.

### 1. Conflict rules spec + test matrix

- [x] Short product spec: who moves silently, who asks, unscheduled vs problematic, no-reply → problematic.
- [x] Rewrite [task-scheduling-test-matrix.md](task-scheduling-test-matrix.md) for the new rules (drop priority-displacement as the primary story).

### 2. Engine: type + preferred, no priority

- [ ] Placement ignores priority (field soft-deprecated).
- [ ] Preferred-first for flexible; fixed stays an anchor.
- [ ] Flexible silent move within phase; recurring move + notify; overflow path ready for problematic.
- [ ] Unit tests for the new matrix cases that belong to the engine only.

### 3. Problematic inbox

- [ ] Model/API distinct from `isUnscheduled` (fell out of schedule).
- [ ] Calendar banner/chip + sheet: open task, move / skip / resolve actions.
- [ ] No-answer / overflow after conflict lands here.

### 4. Shared conflict options + sheet

- [ ] Structured option ids from the engine (`move_other`, `move_new`, `skip_occurrence`, …).
- [ ] One UI sheet for form create and later Voice/drag.
- [ ] Groq only phrases options; applying uses existing APIs.

### 5. Voice on the same decision layer

- [ ] Create / reschedule after parse call the same placement + conflict builder (not a second brain).
- [ ] `needs_conflict_choice` → same sheet; second utterance or tap picks an option.
- [ ] Unscheduled-oriented commands: done / skip / do now (wire as far as APIs allow).
- [ ] Voice unit + P1 e2e for conflict choice.

### 6. Drag → day / phase replan

- [ ] After drag, replan affected phases for that civil day (A→B = both).
- [ ] Flexible: silent shift if a hole exists; else conflict sheet / problematic.
- [ ] Recurring instance moved → user-visible notice.

### 7. Unscheduled actions

- [ ] Card actions: **Done**, **Skip**, **Do now**, **Open**.
- [ ] Deadline with no fit stays Unscheduled (not problematic), with existing overdue tone.
- [ ] Align Voice commands with these actions.

### 8. Recurring extend; shrink Generate

- [ ] Open-ended series and/or background job to extend the local/Google window.
- [ ] Generate becomes “clean up / preview”, not the way recurring stays alive.

### 9. Habits: achievements

- [ ] Unlock catalog (e.g. first check-in, streak 3 / 7 / 30 / 100, clean week).
- [ ] Persist `unlockedAt`; toast once; badges row on Habits.
- [ ] Keep existing points/streaks.

### 10. Habits: AI streak tips

- [ ] On streak thresholds (3 / 7 / 30…), Groq line from habit name/description (humor OK; light safety).
- [ ] Offline fallback templates if Groq is down.
- [ ] Show under streak / after check-in toast.

### Later (not blocking the queue above)

- [ ] **UI language (uk / en)** — chrome and dates still English; voice already multilingual.
- [ ] Voice habit check-in.
- [ ] Pixel-polish for the problematic sheet.

---

## Out of scope (this roadmap)

- Habitica-style RPG / social leaderboards.
- Rewriting STT / mic capture from scratch.
- Restoring priority-based displacement as the main scheduler rule.

---

## Recommended next steps

1. Start at **§2 Engine: type + preferred, no priority**.
2. After each feature ships: tick above, archive a one-liner in [roadmap-archive.md](roadmap-archive.md), update [overview.md](overview.md) / API docs if behavior changed.
