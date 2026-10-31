import {
  cardMotionStage,
  cardMotionState,
  isMotionLocked,
  pendingPlacements,
  placeholderKeys,
  resetMotionForTests,
  setMotionStageSource,
  trackMotion,
} from './cardMotion';

describe('cardMotion intents', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    resetMotionForTests();
    setMotionStageSource(() => null);
  });

  afterEach(() => {
    resetMotionForTests();
    jest.useRealTimers();
  });

  it('marks a card busy while its edit runs and lets go when it is saved', () => {
    const motion = trackMotion({ keys: ['task-1', 'ev-1'], kind: 'edit' });
    expect(cardMotionState(['ev-1'])).toBe('busy');
    expect(isMotionLocked(['ev-1'])).toBe(true);
    motion.settle('done');
    expect(cardMotionState(['ev-1'])).toBeNull();
    expect(isMotionLocked(['ev-1'])).toBe(false);
  });

  it('keeps a deleted card crossed out until it leaves, and restores it on error', () => {
    const deleted = trackMotion({ keys: ['task-1'], kind: 'delete' });
    expect(cardMotionState(['task-1'])).toBe('erasing');
    deleted.settle('done');
    expect(cardMotionState(['task-1'])).toBe('erasing');

    const failed = trackMotion({ keys: ['task-2'], kind: 'delete' });
    failed.settle('error');
    expect(cardMotionState(['task-2'])).toBeNull();
  });

  it('a second tracker joins the running action without widening its keys', () => {
    // The grid starts the drag of one series day …
    const drag = trackMotion({ keys: ['ev-day-3'], kind: 'move' });
    // … then the write tracks the day, the series and the task.
    const write = trackMotion({ keys: ['ev-day-3', 'series-1', 'task-1'], kind: 'edit' });
    expect(cardMotionState(['ev-day-4', 'series-1'])).toBeNull();
    expect(isMotionLocked(['ev-day-3'])).toBe(true);
    write.settle('done');
    expect(isMotionLocked(['ev-day-3'])).toBe(false);
    // First result wins; a later one does not reopen it.
    drag.settle('error');
    expect(cardMotionState(['ev-day-3'])).toBeNull();
  });

  it('stands a placeholder for a create and follows the temp id to the real one', () => {
    const create = trackMotion({
      keys: ['temp-1'],
      kind: 'create',
      title: 'Dentist',
      targetMs: 1_000,
      durationMs: 60_000,
    });
    const [placement] = pendingPlacements();
    expect(placement).toMatchObject({ title: 'Dentist', startMs: 1_000, durationMs: 60_000 });
    create.addKey('task-9');
    expect(placeholderKeys(placement.id)).toEqual([placement.id, 'temp-1', 'task-9']);
    expect(cardMotionState(placeholderKeys(placement.id) ?? [])).toBe('forming');
    // The server is done but Google has not returned the event: the placeholder stays.
    create.settle('done');
    expect(pendingPlacements()).toHaveLength(1);
  });

  it('takes the placeholder away when placing fails', () => {
    const place = trackMotion({ keys: ['task-2'], kind: 'place', from: 'later', targetMs: 5_000 });
    expect(pendingPlacements()).toHaveLength(1);
    place.settle('error');
    expect(pendingPlacements()).toHaveLength(0);
  });

  it('keeps a placeholder alive while Google is slow, then lets it go', () => {
    const place = trackMotion({ keys: ['task-3'], kind: 'place', targetMs: 5_000 });
    place.settle('done');
    jest.advanceTimersByTime(30_000);
    expect(pendingPlacements()).toHaveLength(1);
    jest.advanceTimersByTime(70_000);
    expect(pendingPlacements()).toHaveLength(0);
  });

  it('reads the stage of any of the action keys', () => {
    setMotionStageSource((key) => (key === 'task-1' ? 'syncing' : null));
    trackMotion({ keys: ['ev-1', 'task-1'], kind: 'edit' });
    expect(cardMotionStage(['ev-1'])).toBe('syncing');
  });

  it('forgets a settled action after a while', () => {
    const motion = trackMotion({ keys: ['task-1'], kind: 'delete' });
    motion.settle('done');
    expect(cardMotionState(['task-1'])).toBe('erasing');
    jest.advanceTimersByTime(10_000);
    expect(cardMotionState(['task-1'])).toBeNull();
  });

  it('gives up on an action the server never answers', () => {
    trackMotion({ keys: ['task-1'], kind: 'edit' });
    jest.advanceTimersByTime(31_000);
    expect(isMotionLocked(['task-1'])).toBe(false);
  });
});
