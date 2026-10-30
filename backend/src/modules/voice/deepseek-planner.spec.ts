import {
  DEFAULT_DEEPSEEK_PLANNER_MODEL,
  deepseekPlannerCall,
  deepseekPlannerResult,
} from './deepseek-planner';

describe('deepseekPlannerCall', () => {
  it('asks deepseek-flash for JSON with thinking off', () => {
    const call = deepseekPlannerCall(DEFAULT_DEEPSEEK_PLANNER_MODEL, 'system', 'user');
    expect(call.body.model).toBe('deepseek-flash');
    expect(call.body.thinking).toEqual({ type: 'disabled' });
    expect(call.body.response_format).toEqual({ type: 'json_object' });
    expect(call.body.messages.map((message) => message.role)).toEqual(['system', 'user']);
  });
});

describe('deepseekPlannerResult', () => {
  // WP-F (VR-24): the prompt / completion split is kept when the provider gives it.
  it('keeps the prompt and completion token split', () => {
    const result = deepseekPlannerResult({ choices: [{ message: { content: '{"type":"steps"}' } }], usage: { total_tokens: 20, prompt_tokens: 15, completion_tokens: 5 } } as never);
    expect(result).toMatchObject({ ok: true, tokens: 20, promptTokens: 15, completionTokens: 5 });
  });

  it('returns the answer and ignores reasoning', () => {
    expect(
      deepseekPlannerResult({
        choices: [{ message: { reasoning_content: 'skip', content: '{"type":"steps"}' } }],
        usage: { total_tokens: 20 },
      }),
    ).toEqual({ ok: true, content: '{"type":"steps"}', tokens: 20, promptTokens: null, completionTokens: null });
  });

  it('surfaces an API error', () => {
    expect(deepseekPlannerResult({ error: { message: 'insufficient balance' } })).toEqual({
      ok: false,
      error: 'insufficient balance',
    });
  });
});
