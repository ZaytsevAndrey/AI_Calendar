import { TaskStatus } from '../tasks/entities/task.entity';
import { buildDayPlanProposal, dayPlanToIntents } from './voice-agent.day-plan';
import type { VoiceToolContext } from './voice-agent.tools';

function ctx(overrides: Partial<VoiceToolContext> = {}): VoiceToolContext {
  return {
    userId: 'u1',
    timeZone: 'UTC',
    nowIso: '2026-10-10T12:00:00.000Z',
    settings: { wakeTime: '08:00', sleepTime: '22:00' } as VoiceToolContext['settings'],
    tasks: [],
    slots: [],
    habits: [],
    phases: [],
    ...overrides,
  };
}

describe('voice-agent.day-plan', () => {
  it('seats unscheduled tasks into gaps oldest first', () => {
    const older = {
      id: 't1',
      name: 'A',
      isUnscheduled: true,
      status: TaskStatus.TODO,
      estimatedTimeInMinutes: 30,
      createdAt: new Date('2026-01-01T00:00:00Z'),
    } as any;
    const newer = {
      id: 't2',
      name: 'B',
      isUnscheduled: true,
      status: TaskStatus.TODO,
      estimatedTimeInMinutes: 30,
      createdAt: new Date('2026-01-02T00:00:00Z'),
    } as any;
    const proposal = buildDayPlanProposal(
      ctx({ tasks: [newer, older] }),
      'today',
      {
        day: '2026-10-10',
        gaps: [
          {
            start: '2026-10-10T08:00:00.000Z',
            end: '2026-10-10T10:00:00.000Z',
            minutes: 120,
          },
        ],
      },
    );
    expect(proposal.items.map((item) => item.taskId)).toEqual(['t1', 't2']);
    const intents = dayPlanToIntents(proposal);
    expect(intents).toHaveLength(2);
    expect(intents[0].type).toBe('command');
    expect(String((intents[0] as { command: Record<string, unknown> }).command.kind)).toBe(
      'window',
    );
  });

  it('stops when gaps run out', () => {
    const tasks = [1, 2, 3].map(
      (n) =>
        ({
          id: `t${n}`,
          name: `T${n}`,
          isUnscheduled: true,
          status: TaskStatus.TODO,
          estimatedTimeInMinutes: 60,
          createdAt: new Date(`2026-01-0${n}T00:00:00Z`),
        }) as any,
    );
    const proposal = buildDayPlanProposal(ctx({ tasks }), 'today', {
      day: '2026-10-10',
      gaps: [
        {
          start: '2026-10-10T08:00:00.000Z',
          end: '2026-10-10T09:00:00.000Z',
          minutes: 60,
        },
      ],
    });
    expect(proposal.items).toHaveLength(1);
    expect(proposal.items[0].taskId).toBe('t1');
  });
});
