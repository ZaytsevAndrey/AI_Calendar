import {
  fallbackConflictOptionPhrases,
  parseConflictOptionPhrases,
} from './conflict-option-phrases.util';
import type { SchedulingConflict } from './intelligent-scheduling.engine';

describe('conflict-option-phrases.util', () => {
  const conflict: SchedulingConflict = {
    taskId: 't1',
    taskName: 'Deep work',
    reason: 'preferred_on_fixed',
    options: ['move_new', 'leave_problematic'],
  };

  it('builds fallback phrases for every option id', () => {
    expect(fallbackConflictOptionPhrases(conflict)).toEqual([
      expect.objectContaining({ id: 'move_new', title: expect.any(String) }),
      expect.objectContaining({
        id: 'leave_problematic',
        title: expect.any(String),
      }),
    ]);
  });

  it('parses Groq JSON and keeps only known option ids', () => {
    const raw = JSON.stringify({
      options: [
        { id: 'move_new', title: 'Put it later', detail: 'Next free hour.' },
        { id: 'bogus', title: 'Nope' },
      ],
    });
    expect(parseConflictOptionPhrases(raw, conflict)).toEqual([
      {
        id: 'move_new',
        title: 'Put it later',
        detail: 'Next free hour.',
      },
      expect.objectContaining({ id: 'leave_problematic' }),
    ]);
  });
});
