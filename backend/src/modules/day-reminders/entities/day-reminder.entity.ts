import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../users/user.entity';
import type { DayReminderPattern } from '../day-reminder.dates';

export type DayReminderStatus = 'open' | 'completed';

@Entity('day_reminders')
export class DayReminder {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  userId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column()
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  /** Civil day (YYYY-MM-DD) of the open occurrence, in the user's settings zone. */
  @Column({ type: 'varchar', length: 10 })
  dueYmd: string;

  /** HH:mm notification clock. Null uses the settings default. */
  @Column({ type: 'varchar', length: 5, nullable: true })
  notificationTime: string | null;

  @Column({ type: 'varchar', length: 16, nullable: true })
  recurrencePattern: DayReminderPattern | null;

  /** 0 = Sunday … 6 = Saturday. Used when the pattern is weekly. */
  @Column({ type: 'simple-json', nullable: true })
  recurrenceWeekDays: number[] | null;

  /** Day-of-month anchor for monthly. 31 clamps to the last day of a shorter month. */
  @Column({ type: 'int', nullable: true })
  recurrenceMonthDay: number | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  googleEventId: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  googleEventCalendarId: string | null;

  @Column({ type: 'varchar', length: 16, default: 'open' })
  status: DayReminderStatus;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
