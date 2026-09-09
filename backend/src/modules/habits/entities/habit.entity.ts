import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToMany,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { HabitCheckIn } from './habit-check-in.entity';

@Entity('habits')
export class Habit {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  userId: string;

  @Column({ length: 80 })
  name: string;

  @Column({ length: 7, default: '#3b82f6' })
  color: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @OneToMany(() => HabitCheckIn, (checkIn) => checkIn.habit)
  checkIns: HabitCheckIn[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
