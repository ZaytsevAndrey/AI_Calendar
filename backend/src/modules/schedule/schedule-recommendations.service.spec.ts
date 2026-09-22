import { ServiceUnavailableException } from '@nestjs/common';
import { TaskStatus } from '../tasks/entities/task.entity';
import { ScheduleRecommendationsService } from './schedule-recommendations.service';

describe('ScheduleRecommendationsService', () => {
  const now = new Date('2026-09-22T08:00:00.000Z');

  function service(opts?: {
    tasks?: unknown[];
    slots?: unknown[];
    connected?: boolean;
    events?: unknown[];
    groq?: jest.Mock;
  }) {
    const groq = opts?.groq ?? jest.fn();
    const google = {
      checkConnection: jest
        .fn()
        .mockResolvedValue({ connected: opts?.connected ?? false }),
      getStoredAppCalendarId: jest.fn().mockResolvedValue(null),
      getEvents: jest.fn().mockResolvedValue({ events: opts?.events ?? [] }),
    };
    const chain = {
      innerJoinAndSelect: () => chain,
      where: () => chain,
      andWhere: () => chain,
      orderBy: () => chain,
      take: () => chain,
      getMany: async () => opts?.slots ?? [],
    };
    const instance = new ScheduleRecommendationsService(
      { find: jest.fn().mockResolvedValue(opts?.tasks ?? []) } as never,
      { createQueryBuilder: () => chain } as never,
      {
        getSettings: jest.fn().mockResolvedValue({
          timeZone: 'UTC',
          wakeTime: '07:00:00',
          sleepTime: '23:00:00',
          weekendWorkEnabled: false,
        }),
      } as never,
      { findAll: jest.fn().mockResolvedValue([]) } as never,
      google as never,
      { completeJson: groq } as never,
    );
    return { instance, groq, google };
  }

  it('does not call Groq when there is nothing to review', async () => {
    const { instance, groq } = service();
    const result = await instance.recommend('user-1', now);
    expect(groq).not.toHaveBeenCalled();
    expect(result.suggestions).toEqual([]);
    expect(result.summary).toMatch(/Nothing to review/);
  });

  it('returns parsed suggestions and ignores a bad model payload', async () => {
    const task = {
      id: 'task-1',
      name: 'Write report',
      priority: 'high',
      status: TaskStatus.TODO,
      estimatedTimeInMinutes: 60,
      deadline: new Date('2026-09-23T12:00:00.000Z'),
      earliestStartTime: null,
      isUnscheduled: true,
      isFixedExternal: false,
      isRecurring: false,
      googleEventId: null,
      phases: [],
      phase: null,
      createdAt: now,
    };
    const groq = jest.fn().mockResolvedValue(
      JSON.stringify({
        summary: 'Schedule the report.',
        suggestions: [
          {
            kind: 'deadline_risk',
            title: 'Report',
            detail: 'Write report is unscheduled and due tomorrow.',
            taskId: 'task-1',
          },
        ],
      }),
    );
    const { instance } = service({ tasks: [task], groq });
    const result = await instance.recommend('user-1', now);
    expect(groq).toHaveBeenCalled();
    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0].taskId).toBe('task-1');

    groq.mockResolvedValueOnce('not-json');
    await expect(instance.recommend('user-1', now)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('still returns suggestions when Google events cannot be loaded', async () => {
    const task = {
      id: 'task-1',
      name: 'Write report',
      priority: 'high',
      status: TaskStatus.TODO,
      estimatedTimeInMinutes: 60,
      deadline: null,
      earliestStartTime: null,
      isUnscheduled: false,
      isFixedExternal: false,
      isRecurring: false,
      googleEventId: null,
      phases: [],
      phase: null,
      createdAt: now,
    };
    const groq = jest.fn().mockResolvedValue(
      JSON.stringify({ summary: 'Looks open.', suggestions: [] }),
    );
    const { instance, google } = service({ tasks: [task], connected: true, groq });
    google.getEvents.mockRejectedValue(new Error('token expired'));
    const result = await instance.recommend('user-1', now);
    expect(result.summary).toBe('Looks open.');
    const prompt = String(groq.mock.calls[0][1]);
    expect(prompt).toContain('"externalCalendar":"unavailable"');
  });
});
