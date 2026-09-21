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

  /** Daily reservation start in settings IANA time, `HH:mm`. Null when check-in only. */
  @Column({ type: 'varchar', length: 5, nullable: true })
  blockStartTime: string | null;

  /** Daily reservation length. Set together with `blockStartTime`. */
  @Column({ type: 'int', nullable: true })
  blockMinutes: number | null;

  @OneToMany(() => HabitCheckIn, (checkIn) => checkIn.habit)
  checkIns: HabitCheckIn[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
