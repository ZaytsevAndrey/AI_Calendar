import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { timestampColumnType } from '../../../database/column-types';
import type { CalendarProviderId } from '../../calendar-providers/calendar-provider.types';

/**
 * One linked identity for a local user (Google / Microsoft OAuth, or Apple CalDAV).
 * A user may have several identities; login via a sign-in identity opens the same account.
 * Apple rows are calendar-only (app-specific password in accessToken).
 */
@Entity('user_identities')
@Index(['provider', 'providerUserId'], { unique: true })
export class UserIdentity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  userId: string;

  @Column({ type: 'varchar', length: 32 })
  provider: CalendarProviderId;

  /** Provider subject (`sub` / oid). */
  @Column({ type: 'varchar', length: 255 })
  providerUserId: string;

  @Column({ type: 'varchar', length: 320, nullable: true })
  email: string | null;

  @Column({ type: 'text', nullable: true })
  accessToken: string | null;

  @Column({ type: 'text', nullable: true })
  refreshToken: string | null;

  @Column({ nullable: true, type: timestampColumnType() })
  tokenExpiry: Date | null;

  /** True when this identity was used at registration (default sync target provider). */
  @Column({ default: false })
  isRegistrationIdentity: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
