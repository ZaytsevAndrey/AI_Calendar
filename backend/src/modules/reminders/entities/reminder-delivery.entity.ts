import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

@Entity('reminder_deliveries')
@Unique(['userId', 'dedupeKey'])
@Index(['sentAt'])
export class ReminderDelivery {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  userId: string;

  @Column({ type: 'varchar', length: 512 })
  dedupeKey: string;

  @CreateDateColumn()
  sentAt: Date;
}
