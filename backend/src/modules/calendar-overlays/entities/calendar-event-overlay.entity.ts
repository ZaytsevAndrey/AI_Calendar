import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type {
  CalendarProviderId,
  SchedulingMode,
} from '../../calendar-providers/calendar-provider.types';

@Entity('calendar_event_overlays')
@Index(['userId', 'provider', 'externalEventId'], { unique: true })
export class CalendarEventOverlay {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  userId: string;

  @Column({ type: 'varchar', length: 32 })
  provider: CalendarProviderId;

  @Column({ type: 'varchar', length: 512 })
  externalCalendarId: string;

  @Column({ type: 'varchar', length: 512 })
  externalEventId: string;

  /** fixed | flexible — only set after the user changes type on an external event. */
  @Column({ type: 'varchar', length: 16 })
  schedulingMode: SchedulingMode;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
