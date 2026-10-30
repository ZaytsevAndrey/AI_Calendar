/**
 * AUD-019: optimistic task create/delete on a real RTK store. When the server
 * accepted the change and a later step (the job poll) fails, the list must
 * keep the server's truth: undoing the optimistic patch removed rows by
 * position, so it could drop the real task or a different one.
 */
import { configureStore } from '@reduxjs/toolkit';
import apiCall from 'modules/common/utils/apiCall';
import { settleReplanJob } from 'modules/schedule/settleReplanJob';
import { eventTasksApi } from './eventTasksApi';
import { eventsApi } from './eventsApi';

jest.mock('modules/common/utils/apiCall', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('modules/schedule/settleReplanJob', () => ({ settleReplanJob: jest.fn() }));
jest.mock('modules/schedule/taskMutationProgress', () => ({
  runTaskMutationProgress: async ({ run }: { run: (progress: unknown) => Promise<unknown> }) =>
    run({ retarget: () => undefined, setStage: () => undefined }),
}));
jest.mock('modules/voice/summarizeStoredTask', () => ({ describeStoredTask: () => undefined }));
jest.mock('i18next', () => ({ __esModule: true, default: { t: (key: string) => key } }));

const api = apiCall as jest.Mock;
const settle = settleReplanJob as jest.Mock;

const task = (id: string, name: string) => ({
  id,
  name,
  eventType: 'admin',
  estimatedTimeInMinutes: 30,
  isRecurring: false,
  isUnscheduled: false,
  scheduleState: 'none',
  status: 'todo',
  priority: 'medium',
  allowSplit: false,
  phases: [],
  createdAt: '2026-11-05T08:00:00.000Z',
  updatedAt: '2026-11-05T08:00:00.000Z',
});

function makeStore() {
  return configureStore({
    reducer: {
      [eventTasksApi.reducerPath]: eventTasksApi.reducer,
      [eventsApi.reducerPath]: eventsApi.reducer,
    },
    middleware: (getDefault) =>
      getDefault({ serializableCheck: false, immutableCheck: false }).concat(
        eventTasksApi.middleware,
        eventsApi.middleware,
      ),
  });
}

const flush = async () => {
  for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};
const names = (store: ReturnType<typeof makeStore>) =>
  (eventTasksApi.endpoints.getEvents.select()(store.getState() as never).data ?? []).map((row) => row.name);

describe('eventTasksApi optimistic writes (AUD-019)', () => {
  let serverTasks: ReturnType<typeof task>[];

  beforeEach(() => {
    jest.clearAllMocks();
    serverTasks = [task('a', 'Existing')];
    api.mockImplementation(async ({ url, method = 'GET' }: { url: string; method?: string }) => {
      if (method === 'GET' && url === '/tasks') return { data: [...serverTasks] };
      if (method === 'GET') return { data: [] };
      if (method === 'POST' && url === '/tasks') {
        const created = task('n', 'New task');
        serverTasks = [created, ...serverTasks];
        return { data: { ...created, jobId: 'job-1' } };
      }
      if (method === 'DELETE') {
        serverTasks = serverTasks.filter((row) => `/tasks/${row.id}` !== url);
        return { data: undefined };
      }
      return { data: {} };
    });
  });

  it('a create the server accepted stays listed when its job poll fails', async () => {
    // The poll gives up minutes later: the list was refetched from the server by then.
    settle.mockImplementation(async () => {
      await flush();
      throw new Error('Schedule job timed out');
    });
    const store = makeStore();
    await store.dispatch(eventTasksApi.endpoints.getEvents.initiate() as never);
    await flush();

    await store.dispatch(eventTasksApi.endpoints.createEvent.initiate({ name: 'New task' } as never) as never);
    await flush();

    expect(names(store).sort()).toEqual(['Existing', 'New task']);
  });

  it('a create the server refused removes only its optimistic row', async () => {
    const store = makeStore();
    await store.dispatch(eventTasksApi.endpoints.getEvents.initiate() as never);
    await flush();
    api.mockImplementationOnce(async () => {
      throw Object.assign(new Error('400'), { status: 400 });
    });

    await store.dispatch(eventTasksApi.endpoints.createEvent.initiate({ name: 'New task' } as never) as never);
    await flush();

    expect(names(store)).toEqual(['Existing']);
  });
});
