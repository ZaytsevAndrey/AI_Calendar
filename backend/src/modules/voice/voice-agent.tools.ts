import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HabitCheckIn } from '../habits/entities/habit-check-in.entity';
import { Habit } from '../habits/entities/habit.entity';
import { computeHabitStats } from '../habits/habit-stats.util';
import { Phase } from '../phases/entities/phase.entity';
import { ScheduledTask } from '../schedule/schedule.entity';
import {
  isProblematicSchedule,
  ScheduleState,
  Task,
  TaskStatus,
} from '../tasks/entities/task.entity';
import { UserSettings } from '../user-settings/entities/user-settings.entity';
import {
  addDaysToYmd,
  endOfLocalDayIso,
  inferDueYmd,
  localHm,
  localYmd,
  normalizeClockHm,
  scheduleTodayYmd,
  startOfLocalDayIso,
} from './voice-local-date.util';

export type VoiceToolContext = {
  userId: string;
  timeZone: string;
  nowIso: string;
  settings: UserSettings;
  tasks: Task[];
  slots: ScheduledTask[];
  habits: Habit[];
  phases: Phase[];
};

export type VoiceToolCall = {
  name: string;
  args?: Record<string, unknown>;
};

/** Registry entry — add new tools here and in the orchestrator prompt. */
export const VOICE_READ_TOOL_NAMES = [
  'get_now_next',
  'get_day_agenda',
  'list_unscheduled',
  'list_problematic',
  'find_free_gaps',
  'match_task',
  'match_habit',
  'get_habit_status',
  'get_task',
] as const;

export type VoiceReadToolName = (typeof VOICE_READ_TOOL_NAMES)[number];

@Injectable()
export class VoiceAgentTools {
  constructor(
    @InjectRepository(HabitCheckIn)
    private readonly checkInsRepository: Repository<HabitCheckIn>,
  ) {}

  async execute(
    call: VoiceToolCall,
    ctx: VoiceToolContext,
  ): Promise<unknown> {
    const name = String(call.name || '').trim();
    const args = call.args && typeof call.args === 'object' ? call.args : {};
    switch (name) {
      case 'get_now_next':
        return this.getNowNext(ctx);
      case 'get_day_agenda':
        return this.getDayAgenda(ctx, String(args.day ?? args.ymd ?? ''));
      case 'list_unscheduled':
        return this.listUnscheduled(ctx);
      case 'list_problematic':
        return this.listProblematic(ctx);
      case 'find_free_gaps':
        return this.findFreeGaps(ctx, String(args.day ?? args.ymd ?? ''));
      case 'match_task':
        return this.matchTask(ctx, String(args.query ?? args.name ?? ''));
      case 'match_habit':
        return this.matchHabit(ctx, String(args.query ?? args.name ?? ''));
      case 'get_habit_status':
        return this.getHabitStatus(
          ctx,
          String(args.habitId ?? ''),
          String(args.query ?? args.name ?? ''),
        );
      case 'get_task':
        return this.getTask(ctx, String(args.taskId ?? args.id ?? ''));
      default:
        return { error: `Unknown tool: ${name}` };
    }
  }

  private openTasks(ctx: VoiceToolContext): Task[] {
    return ctx.tasks.filter(
      (task) =>
        task.status !== TaskStatus.COMPLETED &&
        task.status !== TaskStatus.CANCELED,
    );
  }

  private getNowNext(ctx: VoiceToolContext) {
    const nowMs = new Date(ctx.nowIso).getTime();
    const today = localYmd(ctx.nowIso, ctx.timeZone);
    const dayStart = new Date(startOfLocalDayIso(today, ctx.timeZone)).getTime();
    const dayEnd = new Date(endOfLocalDayIso(today, ctx.timeZone)).getTime();
    const open = this.openTasks(ctx);
    const blocks = ctx.slots
      .map((slot) => {
        const task = open.find((row) => row.id === slot.taskId);
        if (!task || task.isUnscheduled) return null;
        const startMs = new Date(slot.scheduledStartTime).getTime();
        const endMs = new Date(slot.scheduledEndTime).getTime();
        if (!(endMs > dayStart && startMs < dayEnd)) return null;
        return {
          taskId: task.id,
          name: task.name,
          startIso: new Date(slot.scheduledStartTime).toISOString(),
          endIso: new Date(slot.scheduledEndTime).toISOString(),
          startMs,
          endMs,
        };
      })
      .filter(Boolean) as Array<{
      taskId: string;
      name: string;
      startIso: string;
      endIso: string;
      startMs: number;
      endMs: number;
    }>;
    blocks.sort((a, b) => a.startMs - b.startMs);
    const now =
      blocks.find((block) => block.startMs <= nowMs && nowMs < block.endMs) ??
      null;
    const next =
      blocks.find((block) => block.startMs >= nowMs && block !== now) ?? null;
    return {
      nowLocal: localHm(ctx.nowIso, ctx.timeZone),
      today,
      now: now
        ? { taskId: now.taskId, name: now.name, start: now.startIso, end: now.endIso }
        : null,
      next: next
        ? {
            taskId: next.taskId,
            name: next.name,
            start: next.startIso,
            end: next.endIso,
          }
        : null,
    };
  }

  private resolveDayYmd(ctx: VoiceToolContext, raw: string): string {
    const trimmed = raw.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
    const today = scheduleTodayYmd(
      ctx.nowIso,
      ctx.timeZone,
      ctx.settings.wakeTime,
    );
    if (!trimmed || /today|сьогодні|сегодня/i.test(trimmed)) return today;
    if (/tomorrow|завтра/i.test(trimmed)) return addDaysToYmd(today, 1);
    return inferDueYmd(trimmed, today) ?? today;
  }

  private getDayAgenda(ctx: VoiceToolContext, dayRaw: string) {
    const ymd = this.resolveDayYmd(ctx, dayRaw);
    const dayStart = new Date(startOfLocalDayIso(ymd, ctx.timeZone)).getTime();
    const dayEnd = new Date(endOfLocalDayIso(ymd, ctx.timeZone)).getTime();
    const open = this.openTasks(ctx);
    const items = ctx.slots
      .map((slot) => {
        const task = open.find((row) => row.id === slot.taskId);
        if (!task || task.isUnscheduled) return null;
        const startMs = new Date(slot.scheduledStartTime).getTime();
        const endMs = new Date(slot.scheduledEndTime).getTime();
        if (!(endMs > dayStart && startMs < dayEnd)) return null;
        return {
          taskId: task.id,
          name: task.name,
          start: new Date(slot.scheduledStartTime).toISOString(),
          end: new Date(slot.scheduledEndTime).toISOString(),
          eventType: task.eventType,
        };
      })
      .filter(Boolean)
      .sort((a, b) => String(a!.start).localeCompare(String(b!.start)));
    return { day: ymd, items, count: items.length };
  }

  private listUnscheduled(ctx: VoiceToolContext) {
    const items = this.openTasks(ctx)
      .filter((task) => task.isUnscheduled)
      .map((task) => ({
        taskId: task.id,
        name: task.name,
        deadline: task.deadline ? new Date(task.deadline).toISOString() : null,
        estimatedTimeInMinutes: task.estimatedTimeInMinutes,
      }));
    return { count: items.length, items };
  }

  private listProblematic(ctx: VoiceToolContext) {
    const items = this.openTasks(ctx)
      .filter((task) => isProblematicSchedule(task))
      .map((task) => ({
        taskId: task.id,
        name: task.name,
        scheduleState: task.scheduleState ?? ScheduleState.PROBLEMATIC,
        problematicDay: task.problematicDay,
        reason: task.problematicReason,
      }));
    return { count: items.length, items };
  }

  private findFreeGaps(ctx: VoiceToolContext, dayRaw: string) {
    const ymd = this.resolveDayYmd(ctx, dayRaw);
    const wake = normalizeClockHm(ctx.settings.wakeTime || '08:00');
    const sleep = normalizeClockHm(ctx.settings.sleepTime || '23:00');
    const dayStart = new Date(
      `${ymd}T${wake}:00${offsetStub(ctx.timeZone, ymd)}`,
    ).getTime();
    // Prefer phase span when available; else wake→sleep.
    let windowStart = dayStart;
    let windowEnd = new Date(
      `${ymd}T${sleep}:00${offsetStub(ctx.timeZone, ymd)}`,
    ).getTime();
    if (ctx.phases.length) {
      const starts = ctx.phases.map((p) =>
        hmToMs(ymd, normalizeClockHm(p.startTime), ctx.timeZone),
      );
      const ends = ctx.phases.map((p) =>
        hmToMs(ymd, normalizeClockHm(p.endTime), ctx.timeZone),
      );
      windowStart = Math.min(...starts);
      windowEnd = Math.max(...ends);
    }
    if (!(windowEnd > windowStart)) {
      return { day: ymd, gaps: [], note: 'Invalid day window' };
    }

    const busy = ctx.slots
      .map((slot) => ({
        start: new Date(slot.scheduledStartTime).getTime(),
        end: new Date(slot.scheduledEndTime).getTime(),
      }))
      .filter((iv) => iv.end > windowStart && iv.start < windowEnd)
      .map((iv) => ({
        start: Math.max(iv.start, windowStart),
        end: Math.min(iv.end, windowEnd),
      }))
      .sort((a, b) => a.start - b.start);

    const merged: Array<{ start: number; end: number }> = [];
    for (const iv of busy) {
      const last = merged[merged.length - 1];
      if (!last || iv.start > last.end) merged.push({ ...iv });
      else last.end = Math.max(last.end, iv.end);
    }

    const gaps: Array<{ start: string; end: string; minutes: number }> = [];
    let cursor = windowStart;
    for (const iv of merged) {
      if (iv.start > cursor) {
        gaps.push(gapEntry(cursor, iv.start));
      }
      cursor = Math.max(cursor, iv.end);
    }
    if (windowEnd > cursor) gaps.push(gapEntry(cursor, windowEnd));
    return {
      day: ymd,
      window: {
        start: new Date(windowStart).toISOString(),
        end: new Date(windowEnd).toISOString(),
      },
      gaps: gaps.filter((g) => g.minutes >= 15),
    };
  }

  private matchTask(ctx: VoiceToolContext, query: string) {
    const q = query.trim().toLowerCase();
    if (!q) return { matches: [] };
    const matches = this.openTasks(ctx)
      .filter((task) => task.name.toLowerCase().includes(q))
      .slice(0, 8)
      .map((task) => ({
        taskId: task.id,
        name: task.name,
        isUnscheduled: task.isUnscheduled,
        scheduleState: task.scheduleState,
      }));
    return { query, matches };
  }

  private matchHabit(ctx: VoiceToolContext, query: string) {
    const q = query.trim().toLowerCase();
    if (!q) return { matches: [] };
    const matches = ctx.habits
      .filter((habit) => habit.name.toLowerCase().includes(q))
      .slice(0, 8)
      .map((habit) => ({ habitId: habit.id, name: habit.name }));
    return { query, matches };
  }

  private async getHabitStatus(
    ctx: VoiceToolContext,
    habitId: string,
    query: string,
  ) {
    let habit =
      (habitId && ctx.habits.find((row) => row.id === habitId)) || undefined;
    if (!habit && query.trim()) {
      const q = query.trim().toLowerCase();
      habit = ctx.habits.find((row) => row.name.toLowerCase().includes(q));
    }
    if (!habit) return { error: 'Habit not found' };
    const today = localYmd(ctx.nowIso, ctx.timeZone);
    const checkIns = await this.checkInsRepository.find({
      where: { habitId: habit.id },
    });
    const ymds = checkIns.map((row) => row.localDate);
    const stats = computeHabitStats(ymds, today);
    return {
      habitId: habit.id,
      name: habit.name,
      today,
      checkedInToday: ymds.includes(today),
      currentStreak: stats.currentStreak,
      points: stats.points,
      blockStartTime: habit.blockStartTime,
      blockMinutes: habit.blockMinutes,
    };
  }

  private getTask(ctx: VoiceToolContext, taskId: string) {
    const task = ctx.tasks.find((row) => row.id === taskId);
    if (!task) return { error: 'Task not found' };
    return {
      taskId: task.id,
      name: task.name,
      status: task.status,
      eventType: task.eventType,
      isUnscheduled: task.isUnscheduled,
      scheduleState: task.scheduleState,
      estimatedTimeInMinutes: task.estimatedTimeInMinutes,
      deadline: task.deadline ? new Date(task.deadline).toISOString() : null,
      scheduledStartTime: task.scheduledStartTime
        ? new Date(task.scheduledStartTime).toISOString()
        : null,
      scheduledEndTime: task.scheduledEndTime
        ? new Date(task.scheduledEndTime).toISOString()
        : null,
      phaseId: task.phaseId,
    };
  }
}

function offsetStub(timeZone: string, ymd: string): string {
  const probe = new Date(`${ymd}T12:00:00.000Z`);
  const raw =
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      timeZoneName: 'longOffset',
      year: 'numeric',
    })
      .formatToParts(probe)
      .find((part) => part.type === 'timeZoneName')?.value ?? 'GMT';
  const match = raw.match(/([+-])(\d{1,2})(?::(\d{2}))?/);
  if (!match) return '+00:00';
  return `${match[1]}${match[2].padStart(2, '0')}:${match[3] ?? '00'}`;
}

function hmToMs(ymd: string, hm: string, timeZone: string): number {
  return new Date(`${ymd}T${hm}:00${offsetStub(timeZone, ymd)}`).getTime();
}

function gapEntry(start: number, end: number) {
  return {
    start: new Date(start).toISOString(),
    end: new Date(end).toISOString(),
    minutes: Math.round((end - start) / 60_000),
  };
}
