import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { timestampColumnType } from '../../database/column-types';

/**
 * Early-access request from the public landing. Not linked to `user`: these are people who do not
 * have an account yet. Emails are stored lowercase and trimmed.
 */
@Entity('waitlist_entries')
export class WaitlistEntry {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 254, unique: true })
  email: string;

  /** Landing language the request came from: `uk` | `en`. */
  @Column({ type: 'varchar', length: 8 })
  locale: string;

  /** Which form on the page (hero, final). */
  @Column({ type: 'varchar', length: 32, nullable: true })
  source: string | null;

  /** Optional follow-up: google | outlook | icloud | none. */
  @Column({ type: 'varchar', length: 16, nullable: true })
  calendar: string | null;

  /** Optional follow-up: "what slips your mind most often". */
  @Column({ type: 'varchar', length: 500, nullable: true })
  pain: string | null;

  /**
   * SHA-256 of the one-time token returned with the request; it authorises the follow-up answers
   * without an account. Replaced on each request for the same email.
   */
  @Index()
  @Column({ type: 'varchar', length: 64, nullable: true })
  tokenHash: string | null;

  @Column({ nullable: true, type: timestampColumnType() })
  detailsAt: Date | null;

  /** Set when the person is let in (allow-list for sign-in, not used yet). */
  @Column({ nullable: true, type: timestampColumnType() })
  invitedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;
}
