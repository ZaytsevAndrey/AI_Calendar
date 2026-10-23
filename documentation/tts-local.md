# Local build, then Piper TTS

The speak path is wired. `VoiceSpeech.speak()` asks `POST /voice/speak`. When `AZURE_SPEECH_KEY` and `AZURE_SPEECH_REGION` are set, the browser plays Azure neural WAV (`uk` Polina, `en` Guy). Otherwise, when `PIPER_URL` is set and `npm run start:piper` is running, it plays Piper. Otherwise it uses the browser voice. The public Render site keeps working either way: Piper runs only on the home API, and Azure speaks only where those two variables are set.

Start the process with `npm run start:piper` after the Piper binary and voices are in `local/piper` (not committed). Voices: `uk_UA-tetiana-high`, `en_US-lessac-medium`.

A public link to this API still needs the tunnel. That step is separate.

## Piper

One HTTP process for every language. The request picks a voice; there is no service per language.

| `speechLanguage` | Voice |
|------------------|--------|
| `uk` | `uk_UA-tetiana-high` |
| `en` | `en_US-lessac-medium` |

Load a voice on first use and keep it in memory. Two or three voices are fine on a 1 GB machine.

- Engine is Piper 1 (**GPL-3**). Run it as its own process and call it over HTTP. Do not vendor it into the Nest repo.
- Those Ukrainian voice weights are **Apache-2.0**.
- Swap the body of `VoiceSpeech.speak()` in `frontend/src/modules/voice/speech.ts`. Call sites stay (`speakVoiceReplies`, clarify / confirm / result / Q&A).
- When Azure Speech is unset, the API on the personal build talks to Piper on localhost and returns audio. The browser plays that audio.

If Ukrainian stress is wrong after a real listen, the fallback candidate is `ukrainian-tts` (MIT, also CPU, has a stress dictionary). That is a later swap of the Ukrainian voice, not a second language service.
