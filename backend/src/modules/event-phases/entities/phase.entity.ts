import { Entity, PrimaryGeneratedColumn, Column, OneToMany, ManyToOne, JoinColumn } from 'typeorm';
import { Task } from '../../tasks/entities/task.entity';

@Entity('phases')
export class Phase {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column()
  color: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column()
  startTime: string;

  @Column()
  endTime: string;

  @Column({ type: 'varchar', length: 36, nullable: true })
  parentPhaseId: string | null;

  @OneToMany(() => Phase, (phase) => phase.parentPhase)
  subphases?: Phase[];

  @ManyToOne(() => Phase, (phase) => phase.subphases, {
    nullable: true,
  })
  @JoinColumn({ name: 'parentPhaseId' })
  parentPhase?: Phase;

  @Column({ type: 'json', nullable: true })
  weekDays: number[] | null; // 0 = Sunday, 1 = Monday, ..., 6 = Saturday

  @Column({ default: 'time_phase' })
  type: string; // 'time_phase' | 'sleep_time'

  /** Owner; phases are per-user. */
  @Column({ type: 'varchar', length: 36, nullable: true })
  userId: string | null;

  @OneToMany(() => Task, (task) => task.phase)
  tasks: Task[];

  @Column({ default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;

  @Column({ default: () => 'CURRENT_TIMESTAMP' })
  updatedAt: Date;
} 