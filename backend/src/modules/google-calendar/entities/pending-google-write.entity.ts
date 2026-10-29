import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

/** A local Google Calendar write that failed and is waiting to be sent again. */
export type PendingGoogleWriteOperation = 'upsert' | 'delete';

@Entity('pending_google_writes')
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
}
