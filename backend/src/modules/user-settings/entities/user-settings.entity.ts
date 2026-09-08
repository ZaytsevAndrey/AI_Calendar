import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../users/user.entity';

@Entity('user_settings')
export class UserSettings {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  userId: string;

  @OneToOne(() => User)
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({ type: 'time', default: '08:00' })
  wakeTime: string;

  @Column({ type: 'time', default: '23:00' })
  sleepTime: string;

  @Column({ default: 25 })
  defaultWorkBlockDuration: number;

  @Column({ default: 5 })
  defaultBreakDuration: number;

  @Column({ default: 120 })
  defaultLunchDuration: number;

  @Column({ type: 'time', default: '12:00' })
  preferredLunchTime: string;

  @Column({ default: false })
  weekendWorkEnabled: boolean;

  @Column({ default: false })
  googleCalendarLinked: boolean;

  /** Display name for the dedicated Google calendar where this app writes events. */
  @Column({ default: 'AI Calendar Assistant' })
  appGoogleCalendarName: string;

  /** Google Calendar id (`...@group.calendar.google.com`) for app-managed events; set when first created. */
  @Column({ type: 'varchar', length: 255, nullable: true })
  appGoogleCalendarId: string | null;

  /** When true (default), types that allow split may be split using `minSplitMinutes`. */
  @Column({ default: true })
  allowSplitScheduling: boolean;

  /** Minimum chunk length when splitting (minutes). */
  @Column({ type: 'int', default: 30 })
  minSplitMinutes: number;

  /** Maximum chunk length when splitting (minutes). */
  @Column({ type: 'int', default: 30 })
  maxSplitMinutes: number;

  /** How many days ahead recurring tasks should be auto-scheduled. */
  @Column({ type: 'int', default: 30 })
  recurringScheduleHorizonDays: number;

  /** IANA time zone (e.g. Europe/Kyiv). Source of truth for schedule day windows. */
  @Column({ type: 'varchar', length: 64, nullable: true })
  timeZone: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
