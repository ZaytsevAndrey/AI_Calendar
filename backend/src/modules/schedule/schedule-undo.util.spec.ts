import {
  isGenerateJobPayload,
  parseUndoSnapshot,
} from './schedule-undo.util';

describe('isGenerateJobPayload', () => {
  it('accepts generate and rejects silent replan', () => {
    expect(isGenerateJobPayload(JSON.stringify({ type: 'generate' }))).toBe(
      true,
    );
    expect(
      isGenerateJobPayload(JSON.stringify({ type: 'full_replan' })),
    ).toBe(false);
    expect(isGenerateJobPayload(null)).toBe(false);
  });
});

describe('parseUndoSnapshot', () => {
  it('requires tasks and segments arrays', () => {
    expect(parseUndoSnapshot(null)).toBeNull();
    expect(parseUndoSnapshot('{"version":1}')).toBeNull();
    expect(
      parseUndoSnapshot(JSON.stringify({ tasks: [], segments: [] })),
    ).toEqual({ version: 1, tasks: [], segments: [] });
  });
});
