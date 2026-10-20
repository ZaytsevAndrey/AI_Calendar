import { DEFAULT_QWEN_PLANNER_MODEL, qwenPlannerCall, qwenPlannerResult } from './qwen-planner';

describe('qwenPlannerCall', () => {
  it('asks qwen3.7-flash for JSON with thinking off', () => {
    const call = qwenPlannerCall(DEFAULT_QWEN_PLANNER_MODEL, 'system', 'user');
    expect(call.body.model).toBe('qwen3.7-flash');
    expect(call.body.enable_thinking).toBe(false);
    expect(call.body.response_format).toEqual({ type: 'json_object' });
    expect(call.body.messages.map((message) => message.role)).toEqual(['system', 'user']);
  });
});

describe('qwenPlannerResult', () => {
  it('returns the answer and ignores reasoning', () => {
    expect(
      qwenPlannerResult({
        choices: [{ message: { reasoning_content: 'skip', content: '{"type":"steps"}' } }],
        usage: { total_tokens: 20 },
      }),
    ).toEqual({ ok: true, content: '{"type":"steps"}', tokens: 20 });
  });

  it('surfaces an API error', () => {
    expect(qwenPlannerResult({ error: { message: 'invalid key' } })).toEqual({
      ok: false,
      error: 'invalid key',
    });
  });
});
