import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToOne,
  JoinColumn,
} from 'typeorm';
import { User } from '../../users/user.entity';

@Entity('user_settings')
export class UserSettings {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  userId: string;

  @OneToOne(() => User)
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({ type: 'time', default: '08:00' })
  wakeTime: string;

  @Column({ type: 'time', default: '23:00' })
  sleepTime: string;

  @Column({ default: 25 })
  defaultWorkBlockDuration: number;

  @Column({ default: 5 })
  defaultBreakDuration: number;

  @Column({ default: 120 })
  defaultLunchDuration: number;

  @Column({ type: 'time', default: '12:00' })
  preferredLunchTime: string;

  @Column({ default: false })
  weekendWorkEnabled: boolean;

  @Column({ default: false })
  googleCalendarLinked: boolean;

  @Column({ default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;

  @Column({ default: () => 'CURRENT_TIMESTAMP', onUpdate: 'CURRENT_TIMESTAMP' })
  updatedAt: Date;
}
