import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

@Entity('voice_daily_usage')
@Unique(['userId', 'dayYmd'])
export class VoiceDailyUsage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid' })
  userId: string;

  /** Civil date in the user's settings IANA zone (`YYYY-MM-DD`). */
  @Column({ type: 'varchar', length: 10 })
  dayYmd: string;

  @Column({ type: 'int', default: 0 })
  tokensUsed: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
