import 'reflect-metadata';
import 'dotenv/config';
import { DataSource, DataSourceOptions } from 'typeorm';
import { User } from './modules/users/user.entity';
import { Task } from './modules/tasks/entities/task.entity';
import { Phase } from './modules/phases/entities/phase.entity';
import { UserSettings } from './modules/user-settings/entities/user-settings.entity';
import { createTypeOrmOptions } from './database/typeorm.config';

export const AppDataSource = new DataSource({
  ...(createTypeOrmOptions() as DataSourceOptions),
  logging: false,
  entities: [User, Task, Phase, UserSettings],
  migrations: ['src/db/migrations/*.ts'],
  subscribers: [],
});
