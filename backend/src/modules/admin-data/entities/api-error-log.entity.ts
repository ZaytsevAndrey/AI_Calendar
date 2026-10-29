import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * One API error from the client API, for the admin console.
 * Path without query; no request body, headers or tokens.
 */
@Entity('api_error_logs')
export class ApiErrorLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 10 })
  method: string;

  @Column({ type: 'varchar', length: 200 })
  path: string;

  @Index()
  @Column({ type: 'int' })
  status: number;

  @Column({ type: 'varchar', length: 80, nullable: true })
  code: string | null;

  @Column({ type: 'varchar', length: 300 })
  message: string;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  userId: string | null;

  @Index()
  @CreateDateColumn()
  createdAt: Date;
}
