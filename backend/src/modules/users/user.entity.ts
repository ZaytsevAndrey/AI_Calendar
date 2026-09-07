import { Column, Entity, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
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

  @OneToMany(() => Task, (task) => task.user)
  tasks: Task[];

  @Column({ default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;

  @Column({ default: () => 'CURRENT_TIMESTAMP', onUpdate: 'CURRENT_TIMESTAMP' })
  updatedAt: Date;
}
