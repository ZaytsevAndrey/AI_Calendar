import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * One finished /voice request, for the admin console.
 * Same data as the `voice.trace` log line: timings, model calls, tokens, codes.
 * No transcript, no model text, no calendar payloads.
 */
@Entity('voice_turn_logs')
export class VoiceTurnLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  userId: string | null;

  @Column({ type: 'varchar', length: 80 })
  traceId: string;

  @Column({ type: 'varchar', length: 10 })
  method: string;

  @Column({ type: 'varchar', length: 120 })
  path: string;

  @Index()
  @Column({ type: 'int' })
  statusCode: number;

  @Column({ type: 'int' })
  totalMs: number;

  @Column({ type: 'int', default: 0 })
  llmCalls: number;

  @Column({ type: 'int', default: 0 })
  llmMs: number;

  @Column({ type: 'int', default: 0 })
  tokens: number;

  /** Steps whose call failed or whose reply was rejected. */
  @Column({ type: 'int', default: 0 })
  failedSteps: number;

  /** First error or validation code on the turn, if any. */
  @Column({ type: 'varchar', length: 80, nullable: true })
  errorCode: string | null;

  /** `VoiceStep[]` as JSON. */
  @Column({ type: 'text' })
  stepsJson: string;

  @Index()
  @CreateDateColumn()
  createdAt: Date;
}
