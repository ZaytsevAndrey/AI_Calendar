import {
  DEFAULT_GEMINI_PLANNER_MODEL,
  geminiPlannerCall,
  geminiPlannerResult,
} from './gemini-planner';

describe('geminiPlannerCall', () => {
  it('asks for JSON with the lowest thinking level Gemini 3.8 Flash allows', () => {
    const call = geminiPlannerCall(DEFAULT_GEMINI_PLANNER_MODEL, 'system', 'user');
    expect(call.url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent',
    );
    expect(call.body.generationConfig.responseMimeType).toBe('application/json');
    expect(call.body.generationConfig.thinkingConfig.thinkingLevel).toBe('low');
    expect(call.body.systemInstruction.parts[0].text).toBe('system');
    expect(call.body.contents[0].parts[0].text).toBe('user');
  });
});

describe('geminiPlannerResult', () => {
  it('returns the JSON part and ignores a thought part', () => {
    const result = geminiPlannerResult({
      candidates: [
        {
          content: {
            parts: [
              { thought: true, text: 'reasoning' },
              { text: '{"type":"steps"}' },
            ],
          },
        },
      ],
      usageMetadata: { totalTokenCount: 42.9 },
    });
    expect(result).toEqual({ ok: true, content: '{"type":"steps"}', tokens: 42 });
  });

  it('surfaces an API error message', () => {
    expect(geminiPlannerResult({ error: { message: 'quota' } })).toEqual({
      ok: false,
      error: 'quota',
    });
  });
});
