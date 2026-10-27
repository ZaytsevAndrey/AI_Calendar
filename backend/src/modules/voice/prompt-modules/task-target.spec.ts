import { TASK_TARGET_MODULE } from './task-target';
import { buildVoiceUpdateSystemPrompt } from '../voice-parse.update.prompt';

describe('task target', () => {
  it('does not bind a bare pronoun to the task happening now', () => {
    expect(TASK_TARGET_MODULE).toMatch(/bare pronoun/i);
    expect(TASK_TARGET_MODULE).toMatch(/needs_clarification/);
    expect(TASK_TARGET_MODULE).toMatch(/його/);
    expect(TASK_TARGET_MODULE).toMatch(/current task/);
    expect(TASK_TARGET_MODULE).not.toMatch(/that is the app task happening now/i);
    expect(buildVoiceUpdateSystemPrompt('uk')).toContain(TASK_TARGET_MODULE);
  });
});
