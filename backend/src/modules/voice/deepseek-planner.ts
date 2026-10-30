/** Official Flash alias. Thinking stays off so output is the JSON only. */
export const DEFAULT_DEEPSEEK_PLANNER_MODEL = 'deepseek-flash';

export type DeepSeekPlannerCall = {
  body: {
    model: string;
    temperature: number;
    max_tokens: number;
    thinking: { type: 'disabled' };
    response_format: { type: 'json_object' };
    messages: Array<{ role: 'system' | 'user'; content: string }>;
  };
};

export function deepseekPlannerCall(
  model: string,
  systemPrompt: string,
  userPrompt: string,
): DeepSeekPlannerCall {
  return {
    body: {
      model: model.trim() || DEFAULT_DEEPSEEK_PLANNER_MODEL,
      temperature: 0.1,
      max_tokens: 4096,
      thinking: { type: 'disabled' },
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    },
  };
}

export type DeepSeekPlannerPayload = {
  choices?: Array<{ message?: { content?: string; reasoning_content?: string } }>;
  usage?: { total_tokens?: number; prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string } | string;
  message?: string;
};

/** Answer text only. Reasoning is billed as output and is not the decision. */
/** Whole numbers from a provider usage block; a missing or odd value is null. */
function tokenCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;
}

export function deepseekPlannerResult(
  payload: DeepSeekPlannerPayload,
): { ok: true; content: string; tokens: number; promptTokens: number | null; completionTokens: number | null } | { ok: false; error: string } {
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
  if (!content) return { ok: false, error: 'DeepSeek planner returned an empty response' };
  const tokens = payload.usage?.total_tokens;
  return {
    ok: true,
    content,
    tokens: typeof tokens === 'number' && Number.isFinite(tokens) ? Math.floor(tokens) : 0,
    promptTokens: tokenCount(payload.usage?.prompt_tokens),
    completionTokens: tokenCount(payload.usage?.completion_tokens),
  };
}
