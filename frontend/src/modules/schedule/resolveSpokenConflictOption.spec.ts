import { resolveSpokenConflictOption } from './resolveSpokenConflictOption';
import type { ConflictOptionId } from './conflictChoiceBus';

const ALL: ConflictOptionId[] = [
  'move_other',
  'move_new',
  'skip_occurrence',
  'place_on_top',
  'leave_problematic',
];

describe('resolveSpokenConflictOption', () => {
  it('matches place elsewhere to move_new', () => {
    expect(resolveSpokenConflictOption('place this task elsewhere', ALL)).toBe('move_new');
  });

  it('matches skip', () => {
    expect(resolveSpokenConflictOption('skip this occurrence', ALL)).toBe('skip_occurrence');
  });

  it('matches place on top', () => {
    expect(resolveSpokenConflictOption('keep this time on top', ALL)).toBe('place_on_top');
  });

  it('matches park / leave', () => {
    expect(resolveSpokenConflictOption('park as problematic', ALL)).toBe('leave_problematic');
  });

  it('matches move the other', () => {
    expect(resolveSpokenConflictOption('move the other task', ALL)).toBe('move_other');
  });

  it('uses ordinals against the offered list order', () => {
    const options: ConflictOptionId[] = ['move_new', 'leave_problematic'];
    expect(resolveSpokenConflictOption('first option', options)).toBe('move_new');
    expect(resolveSpokenConflictOption('second', options)).toBe('leave_problematic');
  });

  it('returns null when the option is not offered', () => {
    expect(resolveSpokenConflictOption('skip', ['move_new', 'leave_problematic'])).toBeNull();
  });

  it('returns null for empty speech', () => {
    expect(resolveSpokenConflictOption('  ', ALL)).toBeNull();
  });
});
