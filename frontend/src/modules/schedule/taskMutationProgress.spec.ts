import { toast } from 'react-toastify';
import {
  getTaskMutationStage,
  startTaskMutationProgress,
} from './taskMutationProgress';
import { cardMotionState, resetMotionForTests } from '../calendar/motion/cardMotion';

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
  beforeEach(() => {
    jest.useFakeTimers();
    (toast as unknown as jest.Mock).mockClear();
    resetMotionForTests();
  });

  afterEach(() => {
    resetMotionForTests();
    jest.useRealTimers();
  });

  it('shows the stages on the card and only the result in a toast', () => {
    const progress = startTaskMutationProgress({ taskKey: 'task-1', title: 'Gym' });
    progress.setStage('placing');
    progress.setStage('syncing');
    expect(toast).not.toHaveBeenCalled();
    expect(cardMotionState(['task-1'])).toBe('busy');
    progress.finish('Fri 14:00');
    expect(toast).toHaveBeenCalledTimes(1);
    expect((toast as unknown as jest.Mock).mock.calls[0][1]).toMatchObject({
      className: 'app-toast-stage-done',
    });
    expect(cardMotionState(['task-1'])).toBeNull();
    expect(getTaskMutationStage('task-1')).toBeNull();
  });

  it('reports a failure in a toast', () => {
    const progress = startTaskMutationProgress({ taskKey: 'task-2', title: 'Gym' });
    progress.fail('Server error');
    expect((toast as unknown as jest.Mock).mock.calls[0][1]).toMatchObject({
      className: 'app-toast-stage-error',
    });
  });

  it('starts the motion kind the caller names', () => {
    const progress = startTaskMutationProgress({
      taskKey: 'task-3',
      title: 'Gym',
      motion: { kind: 'delete' },
    });
    expect(cardMotionState(['task-3'])).toBe('erasing');
    progress.dismiss();
    expect(cardMotionState(['task-3'])).toBeNull();
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

  it('retargets stage keys after optimistic temp id', () => {
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
