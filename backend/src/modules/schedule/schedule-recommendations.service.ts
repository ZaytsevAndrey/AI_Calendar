import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { resolveIanaTimeZone } from '../../common/iana-time-zone';
import { GoogleCalendarService } from '../google-calendar/google-calendar.service';
import { PhasesService } from '../phases/phases.service';
import { Task, TaskStatus } from '../tasks/entities/task.entity';
import { UserSettingsService } from '../user-settings/user-settings.service';
import { GroqClient } from '../voice/groq.client';
import {
  addDaysToYmd,
  localYmd,
  startOfLocalDayIso,
} from '../voice/voice-local-date.util';
import { ScheduledTask } from './schedule.entity';
import {
  clockHm,
  EMPTY_SCHEDULE_RECOMMENDATIONS,
  formatInTimeZone,
  parseScheduleRecommendations,
  SCHEDULE_RECOMMENDATIONS_SYSTEM_PROMPT,
  ScheduleRecommendations,
} from './schedule-recommendations.util';

const HORIZON_DAYS = 7;
const MAX_TASKS = 30;
const MAX_SLOTS = 40;
const MAX_EXTERNAL = 30;

type GoogleEventLike = {
  id?: string | null;
  recurringEventId?: string | null;
  status?: string | null;
  summary?: string | null;
  start?: { dateTime?: string | null; date?: string | null };
  end?: { dateTime?: string | null; date?: string | null };
};

@Injectable()
export class ScheduleRecommendationsService {
  private readonly logger = new Logger(ScheduleRecommendationsService.name);

  constructor(
    @InjectRepository(Task)
    private readonly taskRepo: Repository<Task>,
    @InjectRepository(ScheduledTask)
    private readonly scheduledRepo: Repository<ScheduledTask>,
    private readonly userSettingsService: UserSettingsService,
    private readonly phasesService: PhasesService,
    private readonly googleCalendarService: GoogleCalendarService,
    private readonly groq: GroqClient,
  ) {}

  async recommend(
    userId: string,
    now: Date = new Date(),
  ): Promise<ScheduleRecommendations> {
    const settings = await this.userSettingsService.getSettings(userId);
    const timeZone = resolveIanaTimeZone(settings.timeZone);
    const today = localYmd(now.toISOString(), timeZone);
    const endYmd = addDaysToYmd(today, HORIZON_DAYS);
    const rangeStart = new Date(startOfLocalDayIso(today, timeZone));
    const rangeEnd = new Date(startOfLocalDayIso(endYmd, timeZone));

    const [tasks, phases, slots] = await Promise.all([
      this.loadTasks(userId),
      this.phasesService.findAll(userId),
      this.loadSlots(userId, rangeStart, rangeEnd),
    ]);
    const external = await this.loadExternalEvents(
      userId,
      rangeStart,
      rangeEnd,
      timeZone,
      slots,
      tasks,
    );

    const snapshot = {
      timeZone,
      now: formatInTimeZone(now, timeZone),
      from: today,
      to: endYmd,
      wake: clockHm(settings.wakeTime),
      sleep: clockHm(settings.sleepTime),
      weekendWork: settings.weekendWorkEnabled,
      externalCalendar: external.status,
      phases: phases.map((phase) => ({
        name: phase.name,
        type: phase.type,
        start: clockHm(phase.startTime),
        end: clockHm(phase.endTime),
        weekDays: phase.weekDays,
      })),
      tasks: tasks.map((task) => ({
        id: task.id,
        name: task.name,
        priority: task.priority,
        status: task.status,
        minutes: task.estimatedTimeInMinutes,
        deadline: task.deadline
          ? formatInTimeZone(task.deadline, timeZone)
          : null,
        earliestStart: task.earliestStartTime
          ? formatInTimeZone(task.earliestStartTime, timeZone)
          : null,
        unscheduled: task.isUnscheduled,
        fixed: task.isFixedExternal,
        recurring: task.isRecurring,
        phases: phaseNames(task),
      })),
      slots: slots.map((slot) => ({
        taskId: slot.taskId,
        name: slot.task?.name ?? 'Task',
        start: formatInTimeZone(slot.scheduledStartTime, timeZone),
        end: formatInTimeZone(slot.scheduledEndTime, timeZone),
      })),
      externalEvents: external.events,
    };

    if (
      snapshot.tasks.length === 0 &&
      snapshot.slots.length === 0 &&
      snapshot.externalEvents.length === 0
    ) {
      return EMPTY_SCHEDULE_RECOMMENDATIONS;
    }

    const content = await this.groq.completeJson(
      SCHEDULE_RECOMMENDATIONS_SYSTEM_PROMPT,
      JSON.stringify(snapshot),
    );
    const parsed = parseScheduleRecommendations(
      content,
      new Set(snapshot.tasks.map((task) => task.id)),
    );
    if (!parsed) {
      throw new ServiceUnavailableException(
        'Could not read schedule suggestions',
      );
    }
    return parsed;
  }

  private async loadTasks(userId: string): Promise<Task[]> {
    const tasks = await this.taskRepo.find({
      where: {
        userId,
        status: In([TaskStatus.TODO, TaskStatus.IN_PROGRESS]),
      },
      relations: ['phases', 'phase'],
    });
    tasks.sort((a, b) => {
      const deadlineDelta = deadlineRank(a) - deadlineRank(b);
      if (deadlineDelta !== 0) return deadlineDelta;
      return a.createdAt.getTime() - b.createdAt.getTime();
    });
    return tasks.slice(0, MAX_TASKS);
  }

  private loadSlots(
    userId: string,
    rangeStart: Date,
    rangeEnd: Date,
  ): Promise<ScheduledTask[]> {
    return this.scheduledRepo
      .createQueryBuilder('st')
      .innerJoinAndSelect('st.task', 't')
      .where('t.userId = :userId', { userId })
      .andWhere('st.scheduledEndTime > :rangeStart', { rangeStart })
      .andWhere('st.scheduledStartTime < :rangeEnd', { rangeEnd })
      .orderBy('st.scheduledStartTime', 'ASC')
      .take(MAX_SLOTS)
      .getMany();
  }

  private async loadExternalEvents(
    userId: string,
    rangeStart: Date,
    rangeEnd: Date,
    timeZone: string,
    slots: ScheduledTask[],
    tasks: Task[],
  ): Promise<{
    status: 'connected' | 'not_connected' | 'unavailable';
    events: { title: string; start: string; end: string }[];
  }> {
    try {
      const connection = await this.googleCalendarService.checkConnection(userId);
      if (!connection.connected) {
        return { status: 'not_connected', events: [] };
      }
      const calendarIds = ['primary'];
      const appCalId =
        await this.googleCalendarService.getStoredAppCalendarId(userId);
      if (appCalId && appCalId !== 'primary') calendarIds.push(appCalId);
      const ours = new Set<string>();
      for (const slot of slots) {
        if (slot.googleEventId) ours.add(slot.googleEventId);
      }
      for (const task of tasks) {
        if (task.googleEventId) ours.add(task.googleEventId);
      }
      const events: { title: string; start: string; end: string }[] = [];
      for (const calendarId of calendarIds) {
        const page = await this.googleCalendarService.getEvents(
          userId,
          rangeStart.toISOString(),
          rangeEnd.toISOString(),
          MAX_EXTERNAL,
          undefined,
          calendarId,
        );
        for (const ev of page.events as GoogleEventLike[]) {
          if (events.length >= MAX_EXTERNAL) break;
          const mapped = mapExternalEvent(ev, timeZone, ours);
          if (mapped) events.push(mapped);
        }
      }
      return { status: 'connected', events };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Schedule suggestions skipped Google events: ${message}`);
      return { status: 'unavailable', events: [] };
    }
  }
}

function deadlineRank(task: Task): number {
  return task.deadline ? task.deadline.getTime() : Number.MAX_SAFE_INTEGER;
}

function phaseNames(task: Task): string[] {
  const names = (task.phases ?? []).map((phase) => phase.name).filter(Boolean);
  if (names.length) return [...new Set(names)];
  if (task.phase?.name) return [task.phase.name];
  return [];
}

function mapExternalEvent(
  ev: GoogleEventLike,
  timeZone: string,
  ours: Set<string>,
): { title: string; start: string; end: string } | null {
  if (!ev || ev.status === 'cancelled') return null;
  if (ev.id && ours.has(ev.id)) return null;
  if (ev.recurringEventId && ours.has(ev.recurringEventId)) return null;
  const start = eventBound(ev.start, timeZone);
  const end = eventBound(ev.end, timeZone);
  if (!start || !end) return null;
  const title = (ev.summary || 'Busy').trim().slice(0, 80) || 'Busy';
  return { title, start, end };
}

function eventBound(
  bound: { dateTime?: string | null; date?: string | null } | undefined,
  timeZone: string,
): string | null {
  if (!bound) return null;
  if (bound.dateTime) {
    const date = new Date(bound.dateTime);
    if (Number.isNaN(date.getTime())) return null;
    return formatInTimeZone(date, timeZone);
  }
  if (bound.date) return `${bound.date} all-day`;
  return null;
}
