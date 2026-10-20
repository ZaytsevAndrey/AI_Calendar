# Roadmap

Live queue only. Shipped work is in [roadmap archive](roadmap-archive.md). Product behavior: [overview](overview.md).

**How we work:** one chat = **one feature** below (top open item, or name it). Say *«давай наступну фічу»* / *«next feature»*. Finish → **delete that item from this file** and add a short done note to the archive. This file stays open work only. Do not leave `[x]` lines here.

**Product pillars (Oct 2026 rebuild):** the two features that define the product are **auto-scheduling** and the **voice agent**. Auto-scheduling is the base; the agent is the differentiator. Do not polish TTS / deploy variants until both pillars are trustworthy. Specs: [spec-incremental-placement.md](spec-incremental-placement.md), [spec-conflict-rules.md](spec-conflict-rules.md), [spec-voice-agent.md](spec-voice-agent.md), [voice-prompt-next.md](voice-prompt-next.md).

**Voice understanding (§23)** is already in progress: a little each day against Groq limits (create-eval → fix → goldens). It is **not** a Now item. Track it in [voice-prompt-next.md](voice-prompt-next.md), not in this ordered queue.

---

## Now (ordered)

Do in order unless you explicitly skip ahead. These items need no outside service and no open product decision.

### 31. Database backup

The copy script wipes production tables before it writes. There is no separate backup.

- [ ] Scheduled copy of Postgres and a restore that has been run once.

### 32. Mobile daily path

Below 768px the shell is a bottom tab bar and the calendar opens on day. That pass is not finished.

- [ ] On a phone, finish the daily path: see today, create or speak a task, mark it done.

### 33. Calendar card min height + crowded hour stretch

Short blocks can look too thin. When many events share an hour, the hour row stays the same height.

- [ ] Minimum height for a task card on the day/week grid so the title and chips stay readable.
- [ ] Stretch that hour’s row height when it holds many overlapping or stacked events, so cards do not crush each other.

### 35. Event / task preview — look + content

`EventPreview` ships, but the sheet looks weak and shows almost nothing useful beyond title and time.

- [ ] Redesign the preview layout (hierarchy, spacing, actions).
- [ ] Fill it with the fields people need before Edit: type, phase, duration, deadline / window, calendar source, recurrence, status, description when present — for both app tasks and provider-only events.

---

## Later — decide before building

Do not start these. The shape is still open.

- **§24 Personal-computer build, then local TTS.** Deferred from Now — do after the rest of Now. Handoff: [tts-local.md](tts-local.md). en/uk only. Other languages are [end of queue](#end--external-do-not-start). Build/run variant for a personal computer (stays awake; not the Render free service); on that build only: one Piper HTTP process, voice per request (`uk` Тетяна, `en` Lessac), behind `VoiceSpeech.speak()`.
- **Habits.** Soft-disabled for MVP (no UI/nav/voice/schedule/reminders impact; DB rows and Google habit events left as-is). Re-enable only after we decide what habits should become.
- **Languages beyond en/uk.** UI and speech are en and uk. Pick the set before adding catalogs.
- **STT language: auto vs settings.** Today `speechLanguage` (`en` | `uk`) is a hint to Whisper on `/voice/transcribe`. Investigate whether Whisper already detects the spoken language well enough without that setting, whether a wrong hint hurts accuracy, and whether Settings still needs an explicit speech language (or auto / follow-UI is enough). Decide before changing Settings or the STT call.
- **Admin.** Owner-only. Contents are not chosen. Do not open an empty admin.
- **Hide app calendar.** Visibility toggle for the app-owned calendar — product nuances still open.
- **Outbound sync beyond Google.** Settings stores `syncTargetCalendars`, but app-task create/update/delete still writes Google only. Do not start until that write path is the task.
- **Invite to an event (large).** Add someone to an event. Likely **per calendar provider** (Google / Microsoft / Apple differ on attendees, contact pickers, and OAuth scopes). Before any build: investigate whether we can read contacts at all; design the flow when contacts permission is denied (manual email? paste? skip?); decide where invite lives (preview, editor, voice); agree RSVP / attendees UI. Needs a dedicated product discussion — do not start from a thin ticket.
- **User preference profile (large).** From voice / chat and from the schedule, gather durable facts about the user and inject them into day-plan and Suggestions prompts. Examples: avoid heavy work on days packed with meetings; commute home is ~40 minutes unless they stop somewhere. Before build: what is stored (structured prefs vs free-text notes), who can see/edit/delete it, how often it updates, privacy vs quality. Do not start until that shape is agreed.

---

## End — external, do not start

Third parties and publishing. Leave these until the Now list is done.

- **Payments.** Trial, subscription, and a payment provider. This is what replaces the free voice daily token cap.
- **Privacy policy and Google consent.** A public policy URL, then move the consent screen out of testing so people other than listed test users can sign in.
- **Custom domain.**
- **Next.js landing and lead capture.**
- **Speech for languages other than en/uk.**
- **More calendar providers** beyond Google / Microsoft / Apple.

---

## Out of scope (this roadmap)

- Habitica-style RPG / social leaderboards.
- Rewriting STT / mic capture from scratch.
- Restoring priority-based displacement as the main scheduler rule.
- Competing with Motion/Reclaim on scheduling polish alone (agent quality and trustworthy seating come first).

---

## Recommended next steps

1. In progress: roadmap **§32** — mobile daily path.
2. Then the rest of **Now**: §31 database backup, §33 card min height / crowded hour, §35 preview look + content. (§24 Piper is in Later.)
3. Voice understanding continues in parallel via [voice-prompt-next.md](voice-prompt-next.md); do not put it back in this queue.
4. After each feature ships: delete that item from this file, add a one-liner in [roadmap-archive.md](roadmap-archive.md), update [overview.md](overview.md) / API docs if behavior changed.
