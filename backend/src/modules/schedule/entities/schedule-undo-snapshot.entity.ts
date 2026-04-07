import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

@Entity('schedule_undo_snapshots')
export class ScheduleUndoSnapshot {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  userId: string;

  @Column()
  jobId: string;

  /** Serialized `{ segments: { id, taskId, start, end }[] }` for auto-generated rows only. */
  @Column({ type: 'text' })
  payloadJson: string;

  @CreateDateColumn()
  createdAt: Date;
}
