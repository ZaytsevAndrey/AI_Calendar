/** International Model Studio price tier. Thinking stays off so output is the JSON only. */
export const DEFAULT_QWEN_PLANNER_MODEL = 'qwen3.7-flash';

export type QwenPlannerCall = {
  body: {
    model: string;
    temperature: number;
    max_tokens: number;
    enable_thinking: false;
    response_format: { type: 'json_object' };
    messages: Array<{ role: 'system' | 'user'; content: string }>;
  };
};

export function qwenPlannerCall(
  model: string,
  systemPrompt: string,
  userPrompt: string,
): QwenPlannerCall {
  return {
    body: {
      model: model.trim() || DEFAULT_QWEN_PLANNER_MODEL,
      temperature: 0.1,
      max_tokens: 4096,
      enable_thinking: false,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    },
  };
}

export type QwenPlannerPayload = {
  choices?: Array<{ message?: { content?: string; reasoning_content?: string } }>;
  usage?: { total_tokens?: number };
  error?: { message?: string } | string;
  message?: string;
};

/** Answer text only. Reasoning is billed separately and is not the decision. */
export function qwenPlannerResult(
  payload: QwenPlannerPayload,
): { ok: true; content: string; tokens: number } | { ok: false; error: string } {
  const err = payload.error;
  if (typeof err === 'string' && err.trim()) return { ok: false, error: err.trim() };
  if (err && typeof err === 'object' && typeof err.message === 'string' && err.message.trim()) {
    return { ok: false, error: err.message.trim() };
  }
  if (typeof payload.message === 'string' && payload.message.trim() && !payload.choices?.length) {
    return { ok: false, error: payload.message.trim() };
  }
  const content = (payload.choices?.[0]?.message?.content || '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .trim();
  if (!content) return { ok: false, error: 'Qwen planner returned an empty response' };
  const tokens = payload.usage?.total_tokens;
  return {
    ok: true,
    content,
    tokens: typeof tokens === 'number' && Number.isFinite(tokens) ? Math.floor(tokens) : 0,
  };
}
