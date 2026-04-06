import { DataSource } from 'typeorm';
import { User } from '../modules/users/user.entity';
import { AppDataSource } from '../data-source';

async function updateEmails() {
  await AppDataSource.initialize();
  const userRepository = AppDataSource.getRepository(User);

  const users = await userRepository.find();
  for (const user of users) {
    if (!user.email) {
      user.email = `user${user.id}@example.com`;
      await userRepository.save(user);
    }
  }

  await AppDataSource.destroy();
}

updateEmails().catch((error) => console.error('Error updating emails:', error));
