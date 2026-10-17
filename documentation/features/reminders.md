# PWA reminders

Status: shipped

## Purpose

Tell the user about the next timed thing before it starts, even when the app is closed. Reminders use standard Web Push through the installed PWA or the browser, with no native app. They are opt-in and conservative: one notice per block, nothing for items already in the past, all-day events, or habits already done.

## User-facing behavior

**Turning on**

- Settings has a **Reminders** section with one checkbox. It is off for every account by default (`remindersEnabled = false`).
- Checking it saves the setting, asks the browser for notification permission, subscribes this browser to push, and stores the subscription on the account. A success toast confirms. If anything fails (permission denied, push unsupported, missing server keys) an error toast and a message under the checkbox explain why.
- If reminders are on but this browser has no subscription (for example a second device), an **Allow in this browser** button appears and repeats the subscribe step.
- Unchecking saves the setting, removes this browser's subscription from the server, and unsubscribes the browser.
- On iPhone, Web Push works only after Add to Home Screen, and notification permission is still required. The install banner is only a hint for that step.

**What is sent**

- **Timed blocks.** One notice when a block is within the next 30 minutes: "Starting in N min" with the block title. Blocks are timed events from every visible connected calendar plus the app's own scheduled tasks.
- **Habits with a clock block.** "Habit in N min" with the habit name, for the habit's daily block time.
- **Habits without a block.** One shared "Habits" notice listing their names (cut at 140 characters), sent when the user's wake time is within the next 30 minutes.
- Tapping a notification focuses an open app window or opens the app at `/`.
- Notification copy follows Settings `language` ([language.md](language.md)).

**What is not sent:** all-day events, canceled events, completed or canceled tasks, Unscheduled tasks, blocks that already started, blocks longer than 36 hours, and habits already checked in for that day.

## Logic

**Two triggers, one pipeline.**

- An in-process loop (`ReminderTickProcessor`) calls `dispatchDue()` every **60 seconds** while the API process is awake.
- `POST /reminders/tick` with header `x-reminder-cron-secret` calls the same pipeline. An external free cron hits it about every **30 minutes** so a sleeping free host wakes up. The route returns 503 when `REMINDER_CRON_SECRET` is unset and 401 on a wrong secret (constant-time compare).
- An overlapping run is skipped by an in-memory flag.

**Per tick** (`dispatchDueUnlocked`):

1. If VAPID keys are missing the tick logs once and does nothing.
2. Delete delivery rows older than 3 days.
3. For every account with `remindersEnabled`, skip those with no stored push subscription, then per account:
   1. Read the user's time zone, today's civil date, habits, today's check-ins, all task rows, and recent delivery keys.
   2. Load visible external events from now to now + 30 minutes. If the calendar read fails, log a warning and continue with tasks only.
   3. Build timed blocks (`buildTimedReminderBlocks`): events with a start `dateTime` inside the window; then tasks with a start inside the window that are not covered by an event with the same Google id (or its series id). The task's own stored start and end are used, not the placement tables.
   4. Select due items (`selectDueReminders`): a block is due when `now < start <= now + 30 min`. A habit with a block uses its next occurrence of that clock (later today, or tomorrow when today's time has passed); a habit due today is dropped when already checked. Wake-only habits join one wake notice, subject to the same rule.
   5. For each due item: claim a delivery row `(userId, dedupeKey)` (unique key; a clash means it was already sent), send the push, and delete the claim if no subscription accepted it so the next tick retries.

**Dedupe keys:** `block:<key>:<startMs>`, `habit:<habitId>:<ymd>`, `habits-wake:<ymd>`. They are kept for 3 days.

**Push delivery:** payload `{ title, body, url: '/' }`; web-push TTL 30 minutes (1800 s) and urgency `high`. A 404 or 410 from the push service deletes that subscription; other errors are logged and the notice may still go to the user's other browsers.

What is written: `push_subscriptions` rows, `reminder_deliveries` rows, and `user_settings.remindersEnabled`.

## Edge cases

- **Time of delivery.** A notice goes out on the first tick after the start enters the 30-minute window. With only the 30-minute cron (no awake process) it arrives whenever a cron wake lands inside the window, so anywhere between 30 minutes and just before the start, and a start that falls between two wakes can be missed. The "N min" in the title is computed from the actual send time.
- **Time moved.** Moving a block changes its start, so the key changes and a new notice can be sent for the new time.
- **Recurring event instances** each have their own start and key, so each occurrence reminds once.
- **Several browsers.** All of the user's subscriptions receive a notice; one success counts as sent.
- **Re-subscribing** replaces any existing subscription for the same endpoint and reassigns it to the current user.
- **Subscription rules:** endpoint must be an `https://` URL up to 2000 characters, and both keys up to 255 characters, else 400.
- **Checked habits** are skipped only for the day being reminded. A reminder for tomorrow's early block is not suppressed by today's check-in.
- **Provider errors** do not stop task reminders for that user.
- **Per-user errors** are logged and do not stop other users.
- **Server without VAPID** returns 503 "Web Push is not configured" for the public-key endpoint, so enabling fails on the client.

## Data / settings / API

- Settings: `user_settings.remindersEnabled` (default false), `timeZone`, `wakeTime`, `language`.
- Tables: `push_subscriptions` (`userId`, `endpoint`, `p256dh`, `auth`), `reminder_deliveries` (`userId`, `dedupeKey`, `sentAt`, unique per user and key).
- Authenticated endpoints: `GET /reminders/vapid-public-key`, `POST /reminders/subscriptions`, `DELETE /reminders/subscriptions` (body `endpoint`).
- Cron endpoint: `POST /reminders/tick` with `x-reminder-cron-secret`.
- Env: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (default `mailto:reminders@localhost`), `REMINDER_CRON_SECRET`.
- Frontend: `ReminderSettingsSection`, `browserReminders.ts`, service worker `public/sw.js` (shows the notification, focuses or opens the app on click).
- Constants: lookahead 30 minutes, delivery retention 3 days, push TTL 30 minutes, in-process tick 60 seconds.

## Out of scope

- Per-event snooze, per-event reminder offsets, or a lead-time setting.
- Native mobile push outside the PWA, and email or SMS.
- Reminders for overdue or deadline-only tasks.
- Hosting the external cron ([deploy.md](../deploy.md)).

## Known gaps

- The lead time is fixed at 30 minutes and cannot be changed.
- With no awake process and only the 30-minute cron, delivery time is coarse.
- Event and task fallback titles ("Event", "Task") are hard-coded English even though translated push fallbacks exist.
- Reminders read task rows directly, so a task that is only in the placement tables and not on its task row is not reminded.
- A block whose start time is unchanged is never notified twice within the 3-day retention, even if the user wanted another nudge.
- A start that falls between two cron wakes with no awake process can be missed entirely.
- A habit's wake notice is sent up to 30 minutes before the wake time, not at it.
- Reading all task rows each tick scales with task count per enabled user.

## Related

- [now-next.md](now-next.md)
- [habits.md](habits.md)
- [language.md](language.md)
- [multi-calendar.md](multi-calendar.md)
- [deploy.md](../deploy.md)
- [api-reference.md](../api-reference.md)
