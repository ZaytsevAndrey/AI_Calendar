import { ScheduleState, TaskStatus, type Task } from '../../../tasks/entities/task.entity';
import type { ScheduledTask } from '../../../schedule/schedule.entity';
import type { UserSettings } from '../../../user-settings/entities/user-settings.entity';
import { VoiceAgentTools, type VoiceToolContext } from '../../voice-agent.tools';
import { ReadBroker } from '../broker/read-broker';
import { domainReadExecutor } from '../read/domain-executor';
import type { EntityRecord } from '../reference/reference-resolver';
import { receiptFromMatches, type SearchReceipt } from '../search/receipt';

const USER = 'user-1';

function sameName(left: string, right: string): boolean {
  return left.trim().toLocaleLowerCase() === right.trim().toLocaleLowerCase();
}

/** The in-memory test calendar. External provider calls return no remote events. */
export function toolContextFromEntities(input: {
  entities: EntityRecord[];
  nowIso: string;
  timeZone: string;
  wakeHm: string;
  sleepHm: string;
  userId?: string;
}): VoiceToolContext {
  const userId = input.userId ?? USER;
  const tasks = input.entities
    .filter((entity) => entity.userId === userId && entity.type === 'task')
    .map((entity) => ({
      id: entity.id,
      name: entity.name,
      status: entity.status === 'open' ? TaskStatus.TODO : TaskStatus.CANCELED,
      isUnscheduled: true,
      scheduleState: ScheduleState.NONE,
    } as Task));
  return {
    userId,
    timeZone: input.timeZone,
    nowIso: input.nowIso,
    settings: { wakeTime: input.wakeHm, sleepTime: input.sleepHm } as UserSettings,
    tasks,
    slots: [] as ScheduledTask[],
    phases: [],
    reminders: [],
  };
}

export function domainReadBroker(input: {
  entities: EntityRecord[];
  nowIso: string;
  timeZone: string;
  wakeHm: string;
  sleepHm: string;
  userId?: string;
  failTool?: string;
}): ReadBroker {
  const context = toolContextFromEntities(input);
  const tools = new VoiceAgentTools({ listVisibleEvents: async () => [] } as never);
  const execute = domainReadExecutor(tools, context, async () => undefined);
  return new ReadBroker(async (name, args) => {
    if (input.failTool && name === input.failTool) throw new Error('timeout');
    return execute(name, args);
  });
}

/** Receipt for one name, from the full in-memory catalog. A full page of 8 is not complete. */
export function exhaustiveCatalog(entities: EntityRecord[], userId = USER): (query: { name: string; calendarId?: string }) => SearchReceipt {
  return (query) => {
    const ids = entities
      .filter((entity) => entity.userId === userId && entity.status === 'open' && entity.type !== 'external_event')
      .filter((entity) => query.name && sameName(entity.name, query.name))
      .filter((entity) => !query.calendarId || entity.calendarId === query.calendarId)
      .map((entity) => entity.id);
    return receiptFromMatches(ids);
  };
}
