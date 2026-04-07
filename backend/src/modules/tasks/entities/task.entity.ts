import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  ManyToMany,
  JoinColumn,
  JoinTable,
} from 'typeorm';
import { User } from '../../users/user.entity';
import { Phase } from '../../event-phases/entities/phase.entity';
import { TaskEventType } from '../../scheduling/event-type.enum';

export enum TaskPriority {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  URGENT = 'urgent',
}

export enum TaskStatus {
  TODO = 'todo',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  CANCELED = 'canceled',
}

@Entity('tasks')
export class Task {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ nullable: true, type: 'text' })
  description: string;

  @Column()
  userId: string;

  @ManyToOne(() => User, (user) => user.tasks)
  @JoinColumn({ name: 'userId' })
  user: User;

  /** @deprecated Prefer `phases`; kept for backward compatibility (first phase). */
  @Column({ nullable: true, type: 'varchar' })
  phaseId: string | null;

  @ManyToOne(() => Phase, (phase) => phase.tasks)
  @JoinColumn({ name: 'phaseId' })
  phase: Phase;

  /** Phases whose time windows are eligible for auto-scheduling (union). */
  @ManyToMany(() => Phase)
  @JoinTable({
    name: 'task_phases',
    joinColumn: { name: 'taskId', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'phaseId', referencedColumnName: 'id' },
  })
  phases: Phase[];

  @Column({
    type: 'varchar',
    length: 32,
    default: TaskEventType.ADMIN,
  })
  eventType: TaskEventType;

  @Column({ type: 'int' })
  estimatedTimeInMinutes: number;

  @Column({ default: false })
  isRecurring: boolean;

  @Column({ type: 'varchar', nullable: true })
  recurrencePattern: string | null;

  @Column({ default: true })
  allowSplit: boolean;

  @Column({
    type: 'varchar',
    enum: TaskPriority,
    default: TaskPriority.MEDIUM,
  })
  priority: TaskPriority;

  @Column({ type: 'datetime', nullable: true })
  deadline: Date | null;

  @Column({
    type: 'varchar',
    enum: TaskStatus,
    default: TaskStatus.TODO,
  })
  status: TaskStatus;

  @Column({ type: 'datetime', nullable: true })
  scheduledStartTime: Date | null;

  @Column({ type: 'datetime', nullable: true })
  scheduledEndTime: Date | null;

  @Column({ type: 'varchar', nullable: true })
  googleEventId: string | null;

  @Column({ default: false })
  isFixedExternal: boolean;

  @Column({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;

  @Column({
    type: 'datetime',
    default: () => 'CURRENT_TIMESTAMP',
    onUpdate: 'CURRENT_TIMESTAMP',
  })
  updatedAt: Date;
}
