import { VOICE_READ_TOOL_NAMES } from './voice-agent.tools';
import type { VoiceSessionTurn } from './voice-agent.types';

export function buildVoiceAgentSystemPrompt(language: string): string {
  const lang =
    language === 'uk'
      ? 'Reply to the user in Ukrainian.'
      : 'Reply to the user in English.';
  return `You are the Voice Agent for an AI calendar app.
${lang}
You answer questions about the user's schedule, tasks, and habits using tools.
You do NOT invent free time or move events yourself.

Read tools: ${VOICE_READ_TOOL_NAMES.join(', ')}.

Respond with a single JSON object only, one of:
1) {"type":"tools","calls":[{"name":"<tool>","args":{...}}]}
2) {"type":"mutate"} — create/edit/delete/complete/skip/move/check-in or any write
3) {"type":"propose_plan","day":"today|tomorrow|YYYY-MM-DD|weekday name"} — schedule unscheduled tasks into free gaps for that day (preview)
4) {"type":"final","outcome":"answer"|"clarify"|"refuse","assistantMessage":"<text>","actions":[]}

Rules:
- Prefer tools before answering schedule questions.
- type "mutate" when they name a NEW task/errand (even without "create"/"додай"), e.g. "завтра о другій в магазин", "tomorrow at 2 go to the store".
- Use propose_plan ONLY when they ask to plan/arrange EXISTING unscheduled tasks for a day ("розплануй день", "plan my day", "schedule my unscheduled"). Never propose_plan for a new errand title.
- outcome "clarify" when ambiguous (max 2 clarifications enforced server-side).
- actions may include only: confirm, cancel, retry, skip_speak.
- Keep assistantMessage short and spoken-friendly.
- Never claim you already wrote the calendar; writes happen after client confirm/act.`;
}

export function buildVoiceAgentUserPrompt(input: {
  transcript: string;
  timeZone: string;
  nowIso: string;
  todayYmd: string;
  clarifyCount: number;
  history: VoiceSessionTurn[];
  toolResults?: Array<{ name: string; result: unknown }>;
  actionId?: string;
  hasPendingConfirm?: boolean;
}): string {
  const history =
    input.history.length === 0
      ? '(empty)'
      : input.history
          .map((turn) => `${turn.role}: ${turn.text}`)
          .join('\n');
  const tools =
    input.toolResults && input.toolResults.length
      ? JSON.stringify(input.toolResults, null, 0)
      : '(none yet)';
  return `Timezone (Settings IANA): ${input.timeZone}
Now ISO: ${input.nowIso}
Schedule today (wake-day): ${input.todayYmd}
Clarify count so far: ${input.clarifyCount}/2
Action tap (optional): ${input.actionId || '(none)'}
Pending confirm on server: ${input.hasPendingConfirm ? 'yes' : 'no'}

Chat history:
${history}

Latest user transcript:
${input.transcript || '(action only)'}

Tool results:
${tools}

Return the next JSON decision.
For create/edit mutates, type "mutate" — the server builds the user-facing "created/updated" summary.`;
}
