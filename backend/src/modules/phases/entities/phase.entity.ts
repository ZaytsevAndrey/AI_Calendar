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

  @Column({ nullable: true })
  description?: string;

  @Column()
  startTime: string;

  @Column()
  endTime: string;

  @Column({ nullable: true })
  parentPhaseId?: string;

  @OneToMany(() => Phase, (phase) => phase.parentPhase)
  subphases?: Phase[];

  @ManyToOne(() => Phase, (phase) => phase.subphases, { nullable: true })
  @JoinColumn({ name: 'parentPhaseId' })
  parentPhase?: Phase;

  @Column({ type: 'json', nullable: true })
  weekDays: number[];

  @Column({ default: 'time_phase' })
  type: string; // 'time_phase' | 'sleep_time'

  @OneToMany(() => Task, (task) => task.phase)
  tasks: Task[];

  @Column({ default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;

  @Column({ default: () => 'CURRENT_TIMESTAMP' })
  updatedAt: Date;
} 