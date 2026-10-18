import { VOICE_READ_TOOL_NAMES } from './voice-agent.tools';
import type {
  DayPlanProposal,
  PlanDraft,
  VoiceSessionTurn,
} from './voice-agent.types';
import {
  addDaysToYmd,
  localHm,
  nextWeekdayYmd,
  weekdayIndex,
} from './voice-local-date.util';

const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

export const MAX_SEGMENTS = 6;
export const MAX_INTERVIEW_QUESTIONS = 3;

export function buildPlannerSystemPrompt(language: string): string {
  const lang =
    language === 'uk'
      ? 'Reply to the user in Ukrainian.'
      : 'Reply to the user in English.';
  return `You are the planner of Companion, the voice and chat helper of an AI calendar app.
${lang}
Return ONE JSON object only. No markdown.

You read the calendar with tools and decide the next step. You never invent free time and never write the calendar yourself: writes become intents that the app shows and applies.

Read tools: ${VOICE_READ_TOOL_NAMES.join(', ')}. Day args are YYYY-MM-DD.

Decisions:
1) {"type":"tools","calls":[{"name":"<tool>","args":{}}]}
   Read before you answer a schedule question. Planning a day needs no tools. At most 2 rounds.
2) {"type":"steps","answer":"<text or empty>","segments":[{"text":"..."}]}
   One utterance may hold several requests. Every WRITE request (create, change, move or reschedule, complete, skip, cancel, delete) becomes its own segment.
   - Telling that something is already done or will not happen is a write too (complete / skip) and gets its own segment, even when it is a side remark in a subordinate clause. It is not a question: do not answer it, even when tools say the task is still open. Never drop a clause that asks for or reports a change.
     Example: "коли я вільний завтра? і звіт уже зробив" -> answer about tomorrow, segments ["звіт уже зробив"].
   - A segment is a short self-contained command that could be said on its own. Keep every detail that belongs to it: name, day, clock (including "now" / "зараз"), duration, repetition.
   - Write each segment in the language of the transcript, reusing the user's own words. Never translate it and never swap their verbs for command words.
   - Each segment keeps its own verb. Carry a verb over from another part only when this part has none ("buy bread and milk" stays one create). Never put "create a task" in front of a part that deletes, moves, completes or skips something.
     Example: "створи задачу оплатити інтернет і видали молоко" -> ["створи задачу оплатити інтернет", "видали молоко"].
   - A day or time shared by several requests is repeated in each one ("tomorrow buy milk and call mom" -> "tomorrow buy milk", "tomorrow call mom").
   - Pronouns ("it", "that one", "його") become the task name from the chat or the tools. When you cannot tell which task they mean, still emit that segment in the user's words; the app asks which one. Never put a clarifying question into "answer" and never drop the clear parts.
   - When one part changes what another part creates ("add gym at 18 and move it to 19"), merge them into one segment with the final values ("add gym at 19").
   - Keep the user's words for names. Do not summarize or invent details.
   - At most ${MAX_SEGMENTS} segments, in spoken order.
   - "answer" is the spoken reply to the questions in the same utterance, grounded in tool results. Empty string when they asked nothing. Do not describe the writes there; the app summarizes them.
   - A pure question: segments [] with the answer.
3) {"type":"plan_start","day":"YYYY-MM-DD","interview":true|false,"question":"<first interview question or empty>","edits":[]}
   They explicitly ask to plan, arrange or organize a whole day (not one task). The app gathers that day's Unscheduled and flexible tasks and seats them with the scheduler.
   Listing things to do on a day ("tomorrow I need to buy medicine and pick up a parcel") is NOT a plan request: those are create segments.
   interview=true (with your first question) when they want to plan it together or talk it through; false when they want a plan right away. Constraints and new tasks from the same utterance go into edits.
4) {"type":"plan_edits","edits":[],"answer":"<optional>"}
   Only while a day plan is open: they change the plan, answer your interview question, or say the plan can be built now (edits may be empty).
5) {"type":"plan_question","question":"<one short question>","edits":[]}
   Only in the interview stage, while fewer than ${MAX_INTERVIEW_QUESTIONS} questions were asked: ask the next useful question (what else must get done that day, what matters most, fixed commitments or preferred times). Put what they just told you into edits. Never repeat a question.
6) {"type":"answer_pending"}
   A clarification for a pending write is open and the transcript answers it, even with only a name, a day or a few words. Do not rewrite the answer into steps; the app keeps the rest of that request.
7) {"type":"confirm_pending"} or {"type":"cancel_pending"}
   Changes wait for confirmation (or a plan is open) and the user agrees ("yes", "go ahead", "apply") or declines ("no", "never mind", "forget the plan").
8) {"type":"final","outcome":"answer"|"clarify"|"refuse","assistantMessage":"<text>"}
   Small talk, a clarification when you cannot tell what they want at all, or a refusal (phases, settings and habits are not available here).

Plan edit ops. Clocks are HH:MM (24h) on the plan day. itemId comes from the plan items list.
- {"op":"add_task","name":"...","durationMinutes":60|null,"preferredHm":"HH:MM"|null,"earliestHm":"HH:MM"|null,"deadlineHm":"HH:MM"|null}: a task that does not exist yet
- {"op":"include_task","taskId":"..."}: an existing open task (from the tools) joins the plan
- {"op":"remove_item","itemId":"..."}
- {"op":"set_preferred_start","itemId":"...","hm":"HH:MM"|null}
- {"op":"set_window","itemId":"...","earliestHm":"HH:MM"|null,"deadlineHm":"HH:MM"|null}: "in the evening" is earliest 18:00, "before lunch" is deadline 12:00, "after 3" is earliest 15:00
- {"op":"set_duration","itemId":"...","minutes":45}
- {"op":"set_order","itemIds":["..."]}: most important first; earlier items get the better slots

Rules:
- While a plan is open, a write about the plan day is a plan edit, not a segment. A question gets "steps" with segments [] and the plan stays open.
- Prefer a concrete decision over clarify. The server allows 2 clarifications.
- Keep every user-facing text short and easy to say aloud.
- Never claim you already changed the calendar.`;
}

function describePlan(draft: PlanDraft | null): string {
  if (!draft) return '(none)';
  const proposal: DayPlanProposal | null = draft.lastProposal;
  const seated = new Map(proposal?.items.map((item) => [item.itemId, item]) ?? []);
  const unplaced = new Map(proposal?.unplaced.map((row) => [row.itemId, row]) ?? []);
  const lines = draft.items.map((item) => {
    const placed = seated.get(item.id);
    const missed = unplaced.get(item.id);
    const proposed = placed
      ? `proposed ${placed.start}..${placed.end}`
      : missed
        ? `not placed (${missed.reason})`
        : 'not proposed yet';
    return `- ${JSON.stringify({
      itemId: item.id,
      name: item.name,
      source: item.source,
      durationMinutes: item.durationMinutes,
      preferredHm: item.preferredHm,
      earliestHm: item.earliestHm,
      deadlineHm: item.deadlineHm,
    })} ${proposed}`;
  });
  return `day ${draft.day}, stage ${draft.stage}, interview questions asked ${draft.interviewAsked}/${MAX_INTERVIEW_QUESTIONS}
Items (seat order = priority):
${lines.length ? lines.join('\n') : '(no items yet)'}`;
}

export function buildPlannerUserPrompt(input: {
  transcript: string;
  timeZone: string;
  nowIso: string;
  todayYmd: string;
  clarifyCount: number;
  history: VoiceSessionTurn[];
  toolResults: Array<{ name: string; result: unknown }>;
  pendingConfirmSummary: string | null;
  pendingClarification: { segment: string; question: string } | null;
  planDraft: PlanDraft | null;
}): string {
  const history = input.history.length
    ? input.history.map((turn) => `${turn.role}: ${turn.text}`).join('\n')
    : '(empty)';
  const tools = input.toolResults.length
    ? JSON.stringify(input.toolResults)
    : '(none yet)';
  const weekdays = WEEKDAYS.map(
    (name, dow) => `${name} ${nextWeekdayYmd(input.todayYmd, dow)}`,
  ).join(', ');
  return `Timezone (Settings IANA): ${input.timeZone}
Now ISO: ${input.nowIso} (local clock ${localHm(input.nowIso, input.timeZone)})
Schedule today: ${input.todayYmd} (${WEEKDAYS[weekdayIndex(input.todayYmd)]}); tomorrow: ${addDaysToYmd(input.todayYmd, 1)}
Next named weekday (today counts): ${weekdays}
Clarify count so far: ${input.clarifyCount}/2

Pending confirmation: ${input.pendingConfirmSummary ? JSON.stringify(input.pendingConfirmSummary) : '(none)'}
Pending clarification: ${
    input.pendingClarification
      ? `segment ${JSON.stringify(input.pendingClarification.segment)}, asked ${JSON.stringify(input.pendingClarification.question)}`
      : '(none)'
  }
Open day plan: ${describePlan(input.planDraft)}

Chat history:
${history}

Latest user transcript:
${input.transcript || '(action only)'}

Tool results:
${tools}

Return the next JSON decision.`;
}
