import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * One client operation (HTTP Idempotency-Key), kept apart from the resource
 * it created: deleting the task does not free the key, so a late retry can
 * never create it again. Rows older than the retention window are purged.
 */
@Entity('request_idempotency')
@Index('IDX_request_idempotency_user_op_key', ['userId', 'operation', 'key'], { unique: true })
export class RequestIdempotency {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  userId: string;

  /** What the key was used for, e.g. `task.create`. */
  @Column({ type: 'varchar', length: 32 })
  operation: string;

  @Column({ type: 'varchar', length: 64 })
  key: string;

  /** SHA-256 of the canonical request body: the same key with another body is refused. */
  @Column({ type: 'varchar', length: 64 })
  requestHash: string;

  /** The resource the first request created (it may have been deleted since). */
  @Column({ type: 'varchar', length: 64, nullable: true })
  resourceId: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
