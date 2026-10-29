import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { timestampColumnType } from '../../../database/column-types';

/** A local Google Calendar write that failed and is waiting to be sent again. */
export type PendingGoogleWriteOperation = 'upsert' | 'delete';

/**
 * `pending` waits for `nextRunAt`; `running` is claimed until `leaseUntil`
 * (a dead process's row is taken over after it); `failed` is terminal.
 * A sent row is deleted.
 */
export type PendingGoogleWriteStatus = 'pending' | 'running' | 'failed';

@Entity('pending_google_writes')
@Index('IDX_pending_google_writes_status_next_run', ['status', 'nextRunAt'])
export class PendingGoogleWrite {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  userId: string;

  @Column({ type: 'uuid', nullable: true })
  taskId: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  googleEventId: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  googleCalendarId: string | null;

  @Column({ type: 'varchar', length: 16 })
  operation: PendingGoogleWriteOperation;

  @Column({ type: 'int', default: 0 })
  attempts: number;

  @Column({ type: 'text', nullable: true })
  lastError: string | null;

  @CreateDateColumn()
  enqueuedAt: Date;

  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status: PendingGoogleWriteStatus;

  @Column({ type: timestampColumnType(), nullable: true })
  nextRunAt: Date | null;

  @Column({ type: timestampColumnType(), nullable: true })
  leaseUntil: Date | null;

  /** Bumped by every enqueue; a worker that sent an older revision leaves the row for another pass. */
  @Column({ type: 'int', default: 0 })
  revision: number;
}
