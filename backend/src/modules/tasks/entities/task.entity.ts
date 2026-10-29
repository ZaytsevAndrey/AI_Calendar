import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  ManyToMany,
  JoinColumn,
  JoinTable,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../users/user.entity';
import { Phase } from '../../phases/entities/phase.entity';
import { timestampColumnType } from '../../../database/column-types';
import { TaskEventType } from '../../scheduling/event-type.enum';

export enum TaskPriority {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  URGENT = 'urgent',
}

export enum TaskStatus {
  TODO = 'todo',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  CANCELED = 'canceled',
}

/** Where the task sits relative to placement. Distinct from `TaskStatus`. */
export enum ScheduleState {
  NONE = 'none',
  PROBLEMATIC = 'problematic',
  RESOLVED = 'resolved',
}

export function isProblematicSchedule(task: {
  scheduleState?: ScheduleState | null;
}): boolean {
  return task.scheduleState === ScheduleState.PROBLEMATIC;
}

/** Columns cleared when a task leaves the problematic/resolved park (`scheduleState = none`). */
export function clearedParkColumns(): {
  scheduleState: ScheduleState.NONE;
  problematicOccurrenceYmds: null;
  problematicReason: null;
  problematicDay: null;
  problematicOriginalStart: null;
  problematicOriginalEnd: null;
  parentSeriesId: null;
} {
  return {
    scheduleState: ScheduleState.NONE,
    problematicOccurrenceYmds: null,
    problematicReason: null,
    problematicDay: null,
    problematicOriginalStart: null,
    problematicOriginalEnd: null,
    parentSeriesId: null,
  };
}

export function clearParkMetadata(task: {
  scheduleState: ScheduleState;
  problematicOccurrenceYmds: string[] | null;
  problematicReason: string | null;
  problematicDay: string | null;
  problematicOriginalStart: Date | null;
  problematicOriginalEnd: Date | null;
  parentSeriesId: string | null;
}): void {
  Object.assign(task, clearedParkColumns());
}

/** One parked day is the copy's civil day. Multi-day legacy rows keep the list only. */
export function rememberSingleProblematicDay(task: {
  problematicDay: string | null;
  problematicOccurrenceYmds: string[] | null;
}): void {
  const ymds = task.problematicOccurrenceYmds;
  if (!task.problematicDay && ymds?.length === 1) {
    task.problematicDay = ymds[0];
  }
}

@Entity('tasks')
export class Task {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ nullable: true, type: 'text' })
  description: string;

  @Column()
  userId: string;

  @ManyToOne(() => User, (user) => user.tasks)
  @JoinColumn({ name: 'userId' })
  user: User;

  /** @deprecated Prefer `phases`; kept for backward compatibility (first phase). */
  @Column({ nullable: true, type: 'uuid' })
  phaseId: string | null;

  @ManyToOne(() => Phase, (phase) => phase.tasks)
  @JoinColumn({ name: 'phaseId' })
  phase: Phase;

  /** Phases whose time windows are eligible for auto-scheduling (union). */
  @ManyToMany(() => Phase)
  @JoinTable({
    name: 'task_phases',
    joinColumn: { name: 'taskId', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'phaseId', referencedColumnName: 'id' },
  })
  phases: Phase[];

  @Column({
    type: 'varchar',
    length: 32,
    default: TaskEventType.ADMIN,
  })
  eventType: TaskEventType;

  @Column({ type: 'int' })
  estimatedTimeInMinutes: number;

  @Column({ default: false })
  isRecurring: boolean;

  @Column({ type: 'varchar', nullable: true })
  recurrencePattern: string | null;

  /** 0 = Sunday … 6 = Saturday. Null / all seven days = no extra weekday filter. */
  @Column({ type: 'json', nullable: true })
  recurrenceWeekDays: number[] | null;

  @Column({ default: true })
  allowSplit: boolean;

  @Column({
    type: 'varchar',
    enum: TaskPriority,
    default: TaskPriority.MEDIUM,
  })
  priority: TaskPriority;

  @Column({ type: timestampColumnType(), nullable: true })
  deadline: Date | null;

  /**
   * Movable tasks only. Hard "not before" bound. The engine never overwrites this
   * (unlike scheduledStartTime, which stores the placed slot).
   */
  @Column({ type: timestampColumnType(), nullable: true })
  earliestStartTime: Date | null;

  /**
   * Movable non-recurring tasks: only these weekdays inside the From–Until window.
   * 0 = Sunday … 6 = Saturday. Null / empty = any day in the window.
   */
  @Column({ type: 'json', nullable: true })
  eligibleWeekDays: number[] | null;

  /** IANA zone used to interpret day-only From/Until (e.g. Asia/Nicosia). */
  @Column({ type: 'varchar', length: 64, nullable: true })
  scheduleTimeZone: string | null;

  @Column({
    type: 'varchar',
    enum: TaskStatus,
    default: TaskStatus.TODO,
  })
  status: TaskStatus;

  @Column({ type: timestampColumnType(), nullable: true })
  scheduledStartTime: Date | null;

  @Column({ type: timestampColumnType(), nullable: true })
  scheduledEndTime: Date | null;

  @Column({ type: 'varchar', nullable: true })
  googleEventId: string | null;

  /** Google calendar id where `googleEventId` lives; null = legacy events on `primary`. */
  @Column({ type: 'varchar', length: 255, nullable: true })
  googleEventCalendarId: string | null;

  @Column({ default: false })
  isFixedExternal: boolean;

  /**
   * Inbox item: needs doing, no calendar slot. Not planned by Generate/replan
   * and not synced to Google until the user schedules it.
   */
  @Column({ default: false })
  isUnscheduled: boolean;

  /**
   * `problematic`: no slot until a hole or an explicit move.
   * `resolved`: kept on its slot as a second layer (not seated by later placement).
   * `none`: ordinary task. Cleared park metadata lives only while not `none`.
   */
  @Column({ type: 'varchar', length: 32, default: ScheduleState.NONE })
  scheduleState: ScheduleState;

  /**
   * Civil days (YYYY-MM-DD) that failed to place when parked as problematic.
   * Cleared when `scheduleState` returns to `none`.
   */
  @Column({ type: 'json', nullable: true })
  problematicOccurrenceYmds: string[] | null;

  /**
   * Short engine reason code for the park (phase_full, no_slot, …).
   * Cleared when `scheduleState` returns to `none`.
   */
  @Column({ nullable: true, type: 'varchar', length: 64 })
  problematicReason: string | null;

  /** Civil day (YYYY-MM-DD) of a problematic/resolved copy. */
  @Column({ type: 'varchar', length: 10, nullable: true })
  problematicDay: string | null;

  /** Interval the copy held before it was parked. */
  @Column({ type: timestampColumnType(), nullable: true })
  problematicOriginalStart: Date | null;

  @Column({ type: timestampColumnType(), nullable: true })
  problematicOriginalEnd: Date | null;

  /** Series this copy was detached from. Kept after resolve. */
  @Column({ type: 'uuid', nullable: true })
  parentSeriesId: string | null;

  /**
   * Logical recurring family: primary series plus clock-split siblings and
   * detached one-offs. Survives park clear (unlike `parentSeriesId`).
   * Cleared when the user edits non-time / non-phase fields.
   */
  @Column({ type: 'uuid', nullable: true })
  seriesGroupId: string | null;

  /**
   * Recurring only: civil days (YYYY-MM-DD in settings IANA) the user skipped.
   * Generate/replan must not place those occurrences again.
   */
  @Column({ type: 'json', nullable: true })
  skippedOccurrenceYmds: string[] | null;

  @Column({ nullable: true, type: 'varchar', length: 1024 })
  location: string | null;

  @Column({ nullable: true, type: 'varchar', length: 8 })
  googleColorId: string | null;

  /** Google Event.visibility: default | public | private | confidential */
  @Column({ nullable: true, type: 'varchar', length: 32 })
  googleVisibility: string | null;

  /** Google Event.transparency: opaque | transparent */
  @Column({ nullable: true, type: 'varchar', length: 32 })
  googleTransparency: string | null;

  @Column({ type: 'json', nullable: true })
  googleReminders: {
    useDefault: boolean;
    overrides?: { method: 'email' | 'popup'; minutes: number }[];
  } | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
