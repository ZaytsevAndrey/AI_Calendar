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

  /** Length of a new task when the user does not name one. Not the focus-block length. */
  @Column({ type: 'int', default: 30 })
  defaultTaskDurationMinutes: number;

  @Column({ type: 'time', default: '12:00' })
  preferredLunchTime: string;

  @Column({ default: false })
  weekendWorkEnabled: boolean;

  @Column({ default: false })
  googleCalendarLinked: boolean;

  /**
   * When true, deleting an app event on a connected external calendar also
   * removes it in the app. Off by default. Applies to all providers (legacy
   * name kept for Google-era clients).
   */
  @Column({ default: false })
  syncGoogleDeletions: boolean;

  /**
   * Account that hosts the app calendar for new writes: google, microsoft, or apple.
   * Null until resolved from the sign-in account.
   */
  @Column({ type: 'varchar', length: 16, nullable: true })
  appCalendarProvider: 'google' | 'microsoft' | 'apple' | null;

  /** Outlook calendar id when the write account is Microsoft. */
  @Column({ type: 'varchar', length: 512, nullable: true })
  appMicrosoftCalendarId: string | null;

  /** CalDAV calendar URL when the write account is Apple. */
  @Column({ type: 'varchar', length: 1024, nullable: true })
  appAppleCalendarId: string | null;

  /**
   * Legacy multi-calendar target list. Writers use `appCalendarProvider` instead.
   * Kept for older clients; the Settings UI no longer edits this field.
   */
  @Column({ type: 'simple-json', nullable: true })
  syncTargetCalendars: Array<{ provider: string; calendarId: string }> | null;

  /** Dismissible warning: edits write back to the original calendar. */
  @Column({ default: false })
  dismissWarnExternalWriteBack: boolean;

  /** Dismissible warning: flexible allows moving the event in the original calendar. */
  @Column({ default: false })
  dismissWarnFlexibleMove: boolean;

  /** Dismissible warning: unschedule removes the external event. */
  @Column({ default: false })
  dismissWarnUnscheduleExternal: boolean;

  /** Display name for the dedicated Google calendar where this app writes events. */
  @Column({ default: 'luefy' })
  appGoogleCalendarName: string;

  /** Google Calendar id (`...@group.calendar.google.com`) for app-managed events; set when first created. */
  @Column({ type: 'varchar', length: 255, nullable: true })
  appGoogleCalendarId: string | null;

  /**
   * Google calendar ids hidden on the Calendar page.
   * Empty means show primary, the app calendar, and calendars selected in Google.
   * The app calendar id is ignored if present.
   */
  @Column({ type: 'simple-json', nullable: true })
  hiddenGoogleCalendarIds: string[] | null;

  /** When true (default), types that allow split may be split using `minSplitMinutes`. */
  @Column({ default: true })
  allowSplitScheduling: boolean;

  /**
   * Minutes Generate keeps free before and after each fixed task and external
   * Google event. 0 disables the gap. The engine may still use it when the
   * task would not fit otherwise.
   */
  @Column({ type: 'int', default: 0 })
  fixedEventBufferMinutes: number;

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

  /** Browser push for upcoming blocks and habit check-ins. Off until the user opts in. */
  @Column({ default: false })
  remindersEnabled: boolean;

  /**
   * Default clock for a day reminder that does not set its own time.
   * Google popup is placed at this time.
   */
  @Column({ type: 'varchar', length: 5, default: '09:00' })
  defaultReminderTime: string;

  /**
   * When true, voice complete / skip / reschedule waits for a confirmation.
   * Creating a task by voice is never gated by this flag.
   * Delete / cancel always confirm regardless of this flag.
   */
  @Column({ default: false })
  confirmVoiceCommands: boolean;

  /**
   * When true, the client speaks clarifying questions, confirm summaries, and
   * success/refuse results via Web Speech (or a future TTS backend).
   */
  @Column({ default: true })
  speakVoiceReplies: boolean;

  /** UI and notification language (`en` | `uk`). */
  @Column({ type: 'varchar', length: 8, default: 'en' })
  language: string;

  /**
   * Spoken language for voice STT / TTS / agent replies (`en` | `uk`).
   * Independent of UI `language`.
   */
  @Column({ type: 'varchar', length: 8, default: 'en' })
  speechLanguage: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
