# Roadmap

Live queue only. Shipped work is in [roadmap archive](roadmap-archive.md). Product behavior: [overview](overview.md).

**How we work:** one chat = **one feature** below (top open item, or name it). Say *«давай наступну фічу»* / *«next feature»*. Finish → **delete that item from this file** and add a short done note to the archive. This file stays open work only. Do not leave `[x]` lines here.

**Product pillars (Oct 2026 rebuild):** the two features that define the product are **auto-scheduling** and the **voice agent**. Auto-scheduling is the base; the agent is the differentiator. Do not polish TTS / deploy variants until both pillars are trustworthy. Specs: [spec-incremental-placement.md](spec-incremental-placement.md), [spec-conflict-rules.md](spec-conflict-rules.md), [spec-voice-agent.md](spec-voice-agent.md), [voice-prompt-next.md](voice-prompt-next.md).

**Voice understanding (§23)** is the planner dialogue corpus ([voice-agent-dialogue-test-plan.md](voice-agent-dialogue-test-plan.md)). The old `parseTask` create-eval is removed.

---

## Now (ordered)

Do in order unless you explicitly skip ahead. These items need no outside service and no open product decision. Web only. The full mobile version is **§32**, after this web queue is done.

### 37. Diagnose duplicate / excess fetches

Network looks busy: the same resources seem to refetch too often (calendar events, tasks, settings, habits, and similar).

- [ ] Trace Network / RTK Query / axios on Calendar, Tasks, and Settings: which endpoints fire, how often, and what triggers them (mount, focus, invalidation, polling, overlapping hooks).
- [ ] Write down the duplicate clusters and the smallest fix list (shared cache key, skip duplicate subscribers, tighter invalidation, debounce). Do not rewrite fetching until that note exists.

---

## Later — decide before building

Do not start these. The shape is still open.

- **§31 Database backup.** After production moves to a paid host. Free Neon keeps about six hours of history and has no backup schedule; Render’s disk is ephemeral and Render Cron is paid. The SQLite copy script still wipes production tables before it writes. Do not build a homegrown dump on this free stack. When the paid service is chosen: a scheduled Postgres copy and a restore that has been run once.
- **§24 Personal-computer build, then local TTS.** Deferred from Now — do after the rest of Now. Handoff: [tts-local.md](tts-local.md). en/uk only. Other languages are [end of queue](#end--external-do-not-start). Build/run variant for a personal computer (stays awake; not the Render free service); on that build only: one Piper HTTP process, voice per request (`uk` Тетяна, `en` Lessac), behind `VoiceSpeech.speak()`.
- **Habits.** Soft-disabled for MVP (no UI/nav/voice/schedule/reminders impact; DB rows and Google habit events left as-is). Re-enable only after we decide what habits should become.
- **Languages beyond en/uk.** UI and speech are en and uk. Pick the set before adding catalogs.
- **STT language: auto vs settings.** Today `speechLanguage` (`en` | `uk`) is a hint to Whisper on `/voice/transcribe`, and the Azure Speech test path sends the same setting as `uk-UA` or `en-US`. Investigate whether Whisper already detects the spoken language well enough without that setting, whether a wrong hint hurts accuracy, and whether Settings still needs an explicit speech language (or auto / follow-UI is enough). Decide before changing Settings or the STT call.
- **Admin.** Owner-only. Contents are not chosen. Do not open an empty admin.
- **Hide app calendar.** Visibility toggle for the app-owned calendar — product nuances still open.
- **Outbound sync beyond Google.** Settings stores `syncTargetCalendars`, but app-task create/update/delete still writes Google only. Do not start until that write path is the task.
- **Invite to an event (large).** Add someone to an event. Likely **per calendar provider** (Google / Microsoft / Apple differ on attendees, contact pickers, and OAuth scopes). Before any build: investigate whether we can read contacts at all; design the flow when contacts permission is denied (manual email? paste? skip?); decide where invite lives (preview, editor, voice); agree RSVP / attendees UI. Needs a dedicated product discussion — do not start from a thin ticket.
- **User preference profile (large).** From voice / chat and from the schedule, gather durable facts about the user and inject them into day-plan and Suggestions prompts. Examples: avoid heavy work on days packed with meetings; commute home is ~40 minutes unless they stop somewhere. Before build: what is stored (structured prefs vs free-text notes), who can see/edit/delete it, how often it updates, privacy vs quality. Do not start until that shape is agreed.

---

## After the web

Do not start until the web product is finished. Not a phone polish of one screen.

### 32. Full mobile version

Below 768px the shell already has a bottom tab bar and the calendar opens on day. That is not this item.

- [ ] A complete mobile version of the product, after the web is done.

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

1. Next: roadmap **§37** — diagnose duplicate / excess fetches. (§32 full mobile version is after the web. §31 backup and §24 Piper are in Later.)
2. Voice understanding continues in parallel via [voice-prompt-next.md](voice-prompt-next.md); do not put it back in this queue.
3. After each feature ships: delete that item from this file, add a one-liner in [roadmap-archive.md](roadmap-archive.md), update [overview.md](overview.md) / API docs if behavior changed.
