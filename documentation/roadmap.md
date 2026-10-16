# Roadmap

Live queue only. Shipped work is in [roadmap archive](roadmap-archive.md). Product behavior: [overview](overview.md).

**How we work:** one chat = **one feature** below (top open item, or name it). Say *«давай наступну фічу»* / *«next feature»*. Finish → **delete that item from this file** and add a short done note to the archive. This file stays open work only. Do not leave `[x]` lines here.

**Product pillars (Oct 2026 rebuild):** the two features that define the product are **auto-scheduling** and the **voice agent**. Auto-scheduling is the base; the agent is the differentiator. Do not polish TTS / deploy variants until both pillars are trustworthy. Specs: [spec-incremental-placement.md](spec-incremental-placement.md), [spec-conflict-rules.md](spec-conflict-rules.md), [spec-voice-agent.md](spec-voice-agent.md), [voice-prompt-next.md](voice-prompt-next.md).

**Voice understanding (§23)** is already in progress: a little each day against Groq limits (create-eval → fix → goldens). It is **not** a Now item. Track it in [voice-prompt-next.md](voice-prompt-next.md), not in this ordered queue.

---

## Now (ordered)

Do in order unless you explicitly skip ahead. These items need no outside service and no open product decision.

### 25. Voice — rotate test keys, cap each user

The live API uses only `GROQ_API_KEY`. `GROQ_API_KEY` through `GROQ_API_KEY_6` rotate only in the create-eval script (`GROQ_ROTATE_KEYS`). Free-tier tokens per minute are 8000, so one voice turn can exhaust the minute budget. Friends are the only users for now. A subscription that replaces the cap is [end of queue](#end--external-do-not-start).

- [ ] On the API, rotate those six test keys when Groq answers with a per-minute limit. One turn stays on one key.
- [ ] While voice is free, enforce a per-user ceiling and show a clear limit in the voice sheet.

### 26. Event preview

A click on a calendar event opens the editor. Open a preview first. Delete, edit, and the other actions start from that preview.

- [ ] Preview for an app task and for a Google-only event.
- [ ] Actions that today live on the editor (delete, edit, and the existing series-scope choices) move behind the preview.

### 27. Task-type chip on the calendar card

- [ ] The block shows its kind: fixed, flexible, recurring, habit, or external event.

### 28. Which Google calendar, on the card

- [ ] The card shows which already-connected Google calendar the event belongs to.
- [ ] Non-Google calendars stay in [end of queue](#end--external-do-not-start).

### 29. Type in the voice sheet

- [ ] The voice sheet sends a typed message through the same turn path as speech.

### 30. Delete account

Sign-in is Google-only. Logout exists. There is no delete.

- [ ] Delete the user and their tasks, habits, phases, settings, push subscriptions, and stored Google refresh token.
- [ ] Remove Google events the app created, or ask before removing them.

### 31. Database backup

The copy script wipes production tables before it writes. There is no separate backup.

- [ ] Scheduled copy of Postgres and a restore that has been run once.

### 32. Mobile daily path

Below 768px the shell is a bottom tab bar and the calendar opens on day. That pass is not finished.

- [ ] On a phone, finish the daily path: see today, create or speak a task, mark it done, check in a habit.

### 24. Personal-computer build, then local TTS

Handoff: [tts-local.md](tts-local.md). en/uk only. Other languages are [end of queue](#end--external-do-not-start).

- [ ] Build/run variant for a personal computer (stays awake; not the Render free service).
- [ ] On that build only: one Piper HTTP process, voice per request (`uk` Тетяна, `en` Lessac), behind `VoiceSpeech.speak()`.

---

## Later — decide before building

Do not start these. The shape is still open.

- **Habits.** Check-in, streak, and the calendar block stay until we decide what habits should become.
- **Languages beyond en/uk.** UI and speech are en and uk. Pick the set before adding catalogs.
- **Admin.** Owner-only. Contents are not chosen. Do not open an empty admin.

---

## End — external, do not start

Third parties and publishing. Leave these until the Now list is done.

- **Other calendars.** Providers besides Google.
- **External event as flexible.** Imported events stay fixed anchors. A per-event flexible switch can wait.
- **Payments.** Trial, subscription, and a payment provider. This is what replaces the free voice cap in §25.
- **Privacy policy and Google consent.** A public policy URL, then move the consent screen out of testing so people other than listed test users can sign in.
- **Custom domain.**
- **Next.js landing and lead capture.**
- **Speech for languages other than en/uk.**
- **Invite a contact onto an event.** Not required for the first version.

---

## Out of scope (this roadmap)

- Habitica-style RPG / social leaderboards.
- Rewriting STT / mic capture from scratch.
- Restoring priority-based displacement as the main scheduler rule.
- Competing with Motion/Reclaim on scheduling polish alone (agent quality and trustworthy seating come first).

---

## Recommended next steps

1. Next live item: roadmap **§25** — rotate the six Groq test keys on the API and cap voice per user while it is free.
2. Then the rest of **Now**, in order: §26 preview, §27 type chip, §28 Google calendar label, §29 typed voice, §30 delete account, §31 backup, §32 mobile daily path, §24 Piper ([tts-local.md](tts-local.md)).
3. Voice understanding continues in parallel via [voice-prompt-next.md](voice-prompt-next.md); do not put it back in this queue.
4. After each feature ships: delete that item from this file, add a one-liner in [roadmap-archive.md](roadmap-archive.md), update [overview.md](overview.md) / API docs if behavior changed.
