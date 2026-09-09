import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  Unique,
} from 'typeorm';
import { Habit } from './habit.entity';

@Entity('habit_check_ins')
@Unique(['habitId', 'localDate'])
export class HabitCheckIn {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  habitId: string;

  @ManyToOne(() => Habit, (habit) => habit.checkIns, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'habitId' })
  habit: Habit;

  @Column({ type: 'uuid' })
  userId: string;

  /** Civil date in the user's settings IANA zone (`YYYY-MM-DD`). */
  @Column({ type: 'varchar', length: 10 })
  localDate: string;

  @CreateDateColumn()
  createdAt: Date;
}
