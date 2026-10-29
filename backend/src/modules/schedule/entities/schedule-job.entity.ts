import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { timestampColumnType } from '../../../database/column-types';

export type ScheduleJobStatus = 'pending' | 'running' | 'done' | 'failed';

@Entity('schedule_jobs')
@Index('IDX_schedule_jobs_status_next_run', ['status', 'nextRunAt'])
export class ScheduleJob {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  userId: string;

  @Column({ type: 'varchar', length: 20, default: 'pending' })
  status: ScheduleJobStatus;

  @Column({ type: 'varchar', length: 32, nullable: true })
  progressStage: string | null;

  @Column({ type: 'int', nullable: true })
  progressCurrent: number | null;

  @Column({ type: 'int', nullable: true })
  progressTotal: number | null;

  @Column({ type: 'text', nullable: true })
  payloadJson: string | null;

  @Column({ type: 'text', nullable: true })
  resultDiffJson: string | null;

  @Column({ type: 'text', nullable: true })
  errorMessage: string | null;

  /** Pre-generate local segments + task Google ids. Generate jobs only. */
  @Column({ type: 'text', nullable: true })
  undoSnapshotJson: string | null;

  @Column({ type: timestampColumnType(), nullable: true })
  undoConsumedAt: Date | null;

  /**
   * Durable mutation queue (stabilization A). A `pending` row is work to do;
   * `running` with `leaseUntil` in the past is work a dead process held.
   */
  @Column({ type: 'int', default: 0 })
  attempts: number;

  /** Earliest time a `pending` row may run (retry backoff). Null = now. */
  @Column({ type: timestampColumnType(), nullable: true })
  nextRunAt: Date | null;

  /** A `running` row belongs to its claimer until this time. */
  @Column({ type: timestampColumnType(), nullable: true })
  leaseUntil: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
