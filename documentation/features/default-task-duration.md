# Default task duration

Status: shipped

## Purpose

Give every new task a length when the user did not name one. One Settings value feeds the create form, the voice create prompt, and the `POST /tasks` backfill, so a nameless-length task never reaches placement with a missing or zero duration.

## User-facing behavior

- **Settings → Default task duration** is a number field, 5–480 minutes, default 30. The field clamps typed values into that range and falls back to 30 when the input is not a number. It is saved with the Settings form.
- **Create form.** A new task opens with the duration field already holding the setting. Choosing the Flexible or Recurring preset re-applies the setting to the duration field. The Fixed preset does not touch the duration field, and the duration input is hidden while Fixed is on (start and end are shown instead).
- **Voice create.** The parse prompt tells the model `Default task duration: N minutes.` When the speaker names no length, the created payload carries that value.
- **API create.** A `POST /tasks` body without `estimatedTimeInMinutes` gets the setting. This applies to Unscheduled, recurring, and fixed creates alike.
- **Named length wins.** A length typed in the form, spoken in voice, or sent in the API body is never replaced.
- **Existing tasks do not change** when the setting changes. The setting only affects tasks created afterwards.

## Logic

Decision order for the stored `estimatedTimeInMinutes` on create:

1. Form path: `buildTaskPayload` sends the form value. If that value is missing, a fixed task falls back to the minutes between its start and end, then to 30. In practice the form field is always seeded, so the form value is sent.
2. Voice path: the model emits a duration; `normalizeVoiceParse` rounds it and clamps it to 1–1440. A missing or non-numeric value becomes the setting (`ctx.defaultTaskDurationMinutes`, default 30). The voice service reads the setting through `taskDurationMinutes(settings)`, which returns 30 when the value is missing or below 5.
3. API path: `TasksService.create` uses `createTaskDto.estimatedTimeInMinutes ?? defaultTaskDurationMinutes(userId)`. The helper reads `user_settings`; a missing row or a value below 5 yields 30.

What is written: the resolved number is stored on the task as `estimatedTimeInMinutes`. Nothing records whether it came from the setting or from the user.

Setting repair: `UserSettingsService.getSettings` replaces a null or below-5 stored value with the default 30 and saves it. New settings rows start at 30.

## Edge cases

- **PATCH never backfills.** `PATCH /tasks/:id` leaves `estimatedTimeInMinutes` untouched when the body omits it. Only create fills the default.
- **Fixed tasks.** The backend does not compute duration from `scheduledStartTime` / `scheduledEndTime` when the duration is omitted; it injects the setting. A fixed task's slot comes from its start and end, not from this number.
- **Form fixed tasks.** The form sends the seeded duration field even in Fixed mode, so a fixed task made in the form stores the setting (or whatever the field held), not its span. The span fallback in `buildTaskPayload` only runs if the field is empty.
- **Range mismatch.** The setting accepts 5–480 (`@Min(5) @Max(480)`; the API returns 400 outside that). A task duration accepts 1–1440 (create DTO and form validation). A voice or form value below 5 is valid for a task even though the setting cannot be that small.
- **Unscheduled.** An Unscheduled create without a duration still gets the setting, so the task already has a length when the user later presses Schedule.
- **Habits** are not tasks and ignore this setting.
- **Legacy field.** `defaultWorkBlockDuration` (default 25) is a separate engine-era setting and is not the control labeled Default task duration.

## Data / settings / API

- `user_settings.defaultTaskDurationMinutes` (int, default 30). `PATCH /user-settings` validates 5–480.
- `POST /tasks`: `estimatedTimeInMinutes` optional (1–1440). Omitted → setting → 30.
- `PATCH /tasks/:id`: no backfill.
- Voice: `POST /voice/parse-task` and `POST /voice/turn` pass `defaultTaskDurationMinutes` into the create prompt and the normalizer.
- Frontend: `initialFormValues(…, defaultTaskDurationMinutes)` and `presetPatch(id, minutes)` in `task-wizard`; both ignore a setting below 5 and use 30.

## Out of scope

- Default focus or work block length (`defaultWorkBlockDuration`), break, and lunch durations.
- Recomputing duration from a fixed start/end span on create or edit.
- Per-phase or per-priority default lengths.
- Migrating existing tasks when the setting changes.

## Known gaps

- Fixed tasks created in the form store the form's (hidden) duration field, not their start/end span, so `estimatedTimeInMinutes` can disagree with the slot length.
- `PATCH /tasks/:id` never applies the default, so an edit that omits the duration keeps the old value and nothing can reset a task to "the current default".
- A changed setting does not touch tasks that already exist, and there is no bulk "apply to all" action.

## Related

- [task-creation-rules.md](../task-creation-rules.md)
- [spec-voice-agent.md](../spec-voice-agent.md)
- [habits.md](habits.md)
