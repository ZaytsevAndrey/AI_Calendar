import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { User } from './modules/users/user.entity';
import { Task } from './modules/tasks/entities/task.entity';
import { Phase } from './modules/event-phases/entities/phase.entity';
import { UserSettings } from './modules/user-settings/entities/user-settings.entity';

export const AppDataSource = new DataSource({
  type: 'sqlite',
  database: 'db.sqlite',
  synchronize: true,
  logging: false,
  entities: [User, Task, Phase, UserSettings],
  migrations: ['src/db/migrations/*.ts'],
  subscribers: [],
});
