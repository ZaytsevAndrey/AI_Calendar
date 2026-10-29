# UI language and speech language

Status: shipped

## Purpose

Let a user run the app in English or Ukrainian and speak to it in either, independently. A person can read the UI in Ukrainian and dictate in English (or the reverse), so interface text and voice recognition are separate settings.

## User-facing behavior

Two Settings fields, each `en` or `uk`:

- **App language** (`language`): interface text, weekday and month names, calendar date formats, toast and "when" lines, error messages from the API, push reminder copy, default phase names created by setup, schedule suggestion text, and habit streak tips. The Settings form shows it as a language select with a hint.
- **Speech language** (`speechLanguage`): the language hint for speech-to-text, the language of spoken replies, and the language the voice agent answers in. It is set in the voice section of Settings and saved immediately when changed.

Seeding and syncing:

- On first load of the signed-in app, if the account has no stored `language`, the browser language is detected once (`uk` / `uk-*` becomes Ukrainian; anything else, including no signal, is English). It is written to settings, to local storage (`app_language`), and the UI switches. The same write seeds `speechLanguage` from the guess when speech language is empty.
- When the account already has a language, the UI switches to it (and rewrites local storage) on every load, so a language chosen on another device wins after login.
- Before settings load, the UI uses local storage, then the browser guess, with English as the final fallback.
- Changing App language does not change Speech language, and the reverse.

What does **not** translate: task names, descriptions, phase names the user typed, and anything the user wrote. A few static strings (for example the "Loading…" and "Could not reach the API" cards on the protected route) are hard-coded English.

## Logic

**Frontend** (`i18n/index.ts`, `useSyncAppLanguage`, `dateLocale.ts`):

1. `i18next` initializes with `en` and `uk` catalogs, `lng = stored language ?? browser guess`, fallback `en`.
2. `useSyncAppLanguage` applies the saved `language`, or seeds it once (see above).
3. Date helpers read `i18n.language`: Ukrainian uses the date-fns `uk` locale and `uk-UA` Intl tag; everything else uses `enGB` and `en-GB`.
4. The axios client attaches `Accept-Language: <i18n.language>` to every API request.

**Backend language resolution** (`resolveAppLanguage`): a valid settings language wins; otherwise the first `uk*` or `en*` tag in `Accept-Language`; otherwise English.

- API error messages (`all-exceptions.filter`) call it with the request user's `language` if present, then `Accept-Language`. The authenticated request user carries only `userId` and `username`, so in practice error text follows `Accept-Language`, which mirrors the UI language.
- Features that read stored settings directly use `settings.language`: reminder push copy, schedule suggestions, habit streak tips (`uk` or English only), phase and preset names created by setup.

**Voice language** (`voice.service.ts`):

1. **Speech-to-text hint:** `dto.language || settings.speechLanguage || settings.language`, normalized to a Whisper language code (`en`, `uk`, `ru`). The hint keeps Whisper from guessing; the server cleans the transcript and drops noise-only text.
2. **Router language:** the intent router also returns the detected language of the utterance (`uk`, `en`, or `ru`). The parse and command-resolution steps use it first, then fall back to the settings speech language (`speechLanguage` → `language`).
3. **Agent turns:** the Q&A agent answers in `speechLanguage || language || 'en'`.
4. **Spoken replies:** the client speaks replies in `speechLanguage → language → i18n language → 'en'`.
5. **Text answers** (clarifications, refusals, summaries) are written in the resolved voice language, not the UI language, so a Ukrainian-speaking user on an English UI hears and sees Ukrainian answers.

Fallback chains:

| Use | Order |
|-----|-------|
| UI text | settings `language` → local storage → browser guess → `en` |
| API errors | request user language → `Accept-Language` → `en` |
| Whisper hint | request hint → `speechLanguage` → `language` |
| Voice answers | router-detected language → `speechLanguage` → `language` → `en` |

## Edge cases

- **Missing speech language** is filled from the UI language when settings are read, so existing accounts get a value without a prompt.
- **Russian speech.** The router and Whisper can report `ru`, and the voice resolver handles Russian phrases, but Russian is not a selectable UI or speech setting.
- **Unsupported browser language** (for example German) seeds English.
- **Local storage unavailable:** the app still works; reads return nothing and writes are ignored.
- **User changes language mid-session:** `i18n.changeLanguage` updates the UI at once; stored push and suggestion text already generated stays in the old language.
- **Habit tip language** follows `language`, not `speechLanguage`, even when the check-in came by voice.

## Data / settings / API

- `user_settings.language` (`en` | `uk`) and `user_settings.speechLanguage` (`en` | `uk`), both patched through `PATCH /user-settings`.
- Request header `Accept-Language` on every API call.
- Local storage key `app_language`.
- `POST /voice/transcribe` accepts an optional `language` hint (`en`, `uk`, `ru`).
- Code: `frontend/src/i18n/*`, `useSyncAppLanguage.ts`, `VoiceSettingsSection.tsx`, `useVoiceTask.ts`, `backend/src/i18n/*`, `voice.service.ts`, `voice-agent.orchestrator.ts`.

## Out of scope

- Product decision on STT language: auto-detect versus the setting (roadmap Later).
- Languages beyond English and Ukrainian (roadmap Later / End).
- Auditing every hard-coded English error string.
- Translating user-entered text.

## Known gaps

- The authenticated request user has no `language`, so API errors depend on `Accept-Language` rather than the stored setting; a non-browser client without the header gets English.
- A few frontend strings (route-gate loading and error cards) and some backend error strings are English only.
- Router-detected language can override the speech setting for a single turn, so answers may switch language mid-session.
- Russian is understood by voice but not offered in Settings.
- Already-generated stored text (push bodies, suggestions, habit tips) is not regenerated when the language changes.

## Related

- [voice-quota.md](voice-quota.md)
- [schedule-suggestions.md](schedule-suggestions.md)
- [spec-voice-agent.md](../spec-voice-agent.md)
- [habits.md](habits.md)
- [first-run-phases.md](first-run-phases.md)
