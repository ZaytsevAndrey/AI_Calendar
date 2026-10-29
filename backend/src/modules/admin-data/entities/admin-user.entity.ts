import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { timestampColumnType } from '../../../database/column-types';

/**
 * Admin console accounts. Separate from app users: no Google, no link to `user`.
 * Rows are added by hand (see documentation/admin-console.md). Only the admin API
 * reads this table; the client API only creates it through TYPEORM_SYNC.
 */
@Entity('admin_users')
export class AdminUser {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Stored lowercase. */
  @Column({ type: 'varchar', length: 64, unique: true })
  login: string;

  /** bcrypt hash (cost 12). Never the password itself. */
  @Column({ type: 'varchar', length: 100 })
  passwordHash: string;

  @Column({ default: true })
  isActive: boolean;

  @Column({ nullable: true, type: timestampColumnType() })
  lastLoginAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;
}
