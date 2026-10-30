/** Companion planner. Gemini 3.8 Flash has no "off" thinking level; `low` is the minimum. */
export const DEFAULT_GEMINI_PLANNER_MODEL = 'gemini-3.8-flash';

const GEMINI_GENERATE_BASE =
  'https://generativelanguage.googleapis.com/v1beta/models';

export type GeminiPlannerCall = {
  url: string;
  body: {
    systemInstruction: { parts: Array<{ text: string }> };
    contents: Array<{ role: string; parts: Array<{ text: string }> }>;
    generationConfig: {
      temperature: number;
      maxOutputTokens: number;
      responseMimeType: string;
      thinkingConfig: { thinkingLevel: 'low' };
    };
  };
};

export function geminiPlannerCall(
  model: string,
  systemPrompt: string,
  userPrompt: string,
): GeminiPlannerCall {
  const id = model.trim() || DEFAULT_GEMINI_PLANNER_MODEL;
  return {
    url: `${GEMINI_GENERATE_BASE}/${encodeURIComponent(id)}:generateContent`,
    body: {
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 4096,
        responseMimeType: 'application/json',
        thinkingConfig: { thinkingLevel: 'low' },
      },
    },
  };
}

type GeminiPart = { text?: string; thought?: boolean };

export type GeminiPlannerPayload = {
  candidates?: Array<{ content?: { parts?: GeminiPart[] } }>;
  usageMetadata?: { totalTokenCount?: number; promptTokenCount?: number; candidatesTokenCount?: number };
  error?: { message?: string } | string;
};

/** Visible JSON only. Thought parts are not the planner decision. */
/** Whole numbers from a provider usage block; a missing or odd value is null. */
function tokenCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;
}

export function geminiPlannerResult(
  payload: GeminiPlannerPayload,
): { ok: true; content: string; tokens: number; promptTokens: number | null; completionTokens: number | null } | { ok: false; error: string } {
  const err = payload.error;
  if (typeof err === 'string' && err.trim()) return { ok: false, error: err.trim() };
  if (err && typeof err === 'object' && typeof err.message === 'string' && err.message.trim()) {
    return { ok: false, error: err.message.trim() };
  }
  const parts = payload.candidates?.[0]?.content?.parts ?? [];
  const content = parts
    .filter((part) => part?.thought !== true && typeof part?.text === 'string')
    .map((part) => part.text as string)
    .join('')
    .trim();
  if (!content) return { ok: false, error: 'Gemini planner returned an empty response' };
  const tokens = payload.usageMetadata?.totalTokenCount;
  return {
    ok: true,
    content,
    tokens: typeof tokens === 'number' && Number.isFinite(tokens) ? Math.floor(tokens) : 0,
    promptTokens: tokenCount(payload.usageMetadata?.promptTokenCount),
    completionTokens: tokenCount(payload.usageMetadata?.candidatesTokenCount),
  };
}
