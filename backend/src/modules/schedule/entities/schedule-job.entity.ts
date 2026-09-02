import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

export type ScheduleJobStatus = 'pending' | 'running' | 'done' | 'failed';

@Entity('schedule_jobs')
export class ScheduleJob {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  userId: string;

  @Column({ type: 'varchar', length: 20, default: 'pending' })
  status: ScheduleJobStatus;

  @Column({ type: 'text', nullable: true })
  payloadJson: string | null;

  @Column({ type: 'text', nullable: true })
  resultDiffJson: string | null;

  @Column({ type: 'text', nullable: true })
  errorMessage: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
