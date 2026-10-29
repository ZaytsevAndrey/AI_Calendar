import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { timestampColumnType } from '../../database/column-types';
import { Task } from '../tasks/entities/task.entity';

@Entity()
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ nullable: true, unique: true })
  username: string;

  @Column({ unique: true })
  email: string;

  /** Google subject (`sub`); set when the user signs in with Google. */
  @Column({ type: 'varchar', length: 255, nullable: true, unique: true })
  googleId: string | null;

  @Column()
  password: string;

  @Column({ nullable: true, type: 'text' })
  resetToken: string | null;

  @Column({ nullable: true, type: 'text' })
  refreshToken: string | null;

  @Column({ nullable: true, type: 'text' })
  googleAccessToken: string | null;

  @Column({ nullable: true, type: 'text' })
  googleRefreshToken: string | null;

  @Column({ nullable: true, type: timestampColumnType() })
  googleTokenExpiry: Date | null;

  @Column({ default: false })
  isEmailVerified: boolean;

  /** Set by the owner in the admin console. A blocked user cannot call the API. */
  @Column({ default: false })
  isBlocked: boolean;

  /**
   * "Sign out everywhere" from the admin console. Tokens issued before this
   * second are refused, including 7-day refresh JWTs used as bearer tokens.
   */
  @Column({ nullable: true, type: timestampColumnType() })
  sessionsRevokedAt: Date | null;

  /** Last authenticated API call, written at most every few minutes. */
  @Column({ nullable: true, type: timestampColumnType() })
  lastActiveAt: Date | null;

  @OneToMany(() => Task, (task) => task.user)
  tasks: Task[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
