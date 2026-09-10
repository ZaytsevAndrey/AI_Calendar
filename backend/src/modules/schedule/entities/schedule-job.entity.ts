import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { timestampColumnType } from '../../../database/column-types';

export type ScheduleJobStatus = 'pending' | 'running' | 'done' | 'failed';

@Entity('schedule_jobs')
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

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
