import {
  MUTATION_STAGE_COLORS,
  getTaskMutationStage,
  startTaskMutationProgress,
} from './taskMutationProgress';

jest.mock('react-toastify', () => ({
  toast: Object.assign(jest.fn(), {
    update: jest.fn(),
    dismiss: jest.fn(),
  }),
}));

jest.mock('i18next', () => ({
  __esModule: true,
  default: { t: (key: string) => key },
}));

describe('taskMutationProgress', () => {
  it('exposes distinct colors for each stage', () => {
    const colors = Object.values(MUTATION_STAGE_COLORS);
    expect(new Set(colors).size).toBe(colors.length);
  });

  it('tracks stage for taskKey and relatedKeys', () => {
    const progress = startTaskMutationProgress({
      taskKey: 'task-1',
      title: 'Gym',
      relatedKeys: ['evt-1'],
    });
    expect(getTaskMutationStage('task-1')).toBe('saving');
    expect(getTaskMutationStage('evt-1')).toBe('saving');
    progress.setStage('syncing');
    expect(getTaskMutationStage('task-1')).toBe('syncing');
    expect(getTaskMutationStage('evt-1')).toBe('syncing');
    progress.dismiss();
    expect(getTaskMutationStage('task-1')).toBeNull();
    expect(getTaskMutationStage('evt-1')).toBeNull();
  });

  it('retargets tint keys after optimistic temp id', () => {
    const progress = startTaskMutationProgress({
      taskKey: 'temp-1',
      title: 'New',
    });
    progress.retarget('real-1');
    progress.setStage('placing');
    expect(getTaskMutationStage('temp-1')).toBeNull();
    expect(getTaskMutationStage('real-1')).toBe('placing');
    progress.dismiss();
  });
});
