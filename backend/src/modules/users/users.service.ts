import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { User } from './user.entity';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private usersRepository: Repository<User>,
  ) {}

  async findOne(username: string): Promise<User | null> {
    return this.usersRepository.findOne({ where: { username } });
  }

  async create(username: string, password: string): Promise<User> {
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = this.usersRepository.create({
      username,
      password: hashedPassword,
    });
    return this.usersRepository.save(user);
  }

  async findById(id: string): Promise<User | null> {
    return this.usersRepository.findOne({ where: { id } });
  }

  async updatePassword(userId: string, newPassword: string): Promise<void> {
    const hashed = await bcrypt.hash(newPassword, 10);
    await this.usersRepository.update({ id: userId }, { password: hashed });
  }

  async setRefreshToken(userId: string, token: string): Promise<void> {
    await this.usersRepository.update({ id: userId }, { refreshToken: token });
  }

  async getUserIfRefreshTokenMatches(
    userId: string,
    token: string,
  ): Promise<User | null> {
    const user = await this.usersRepository.findOne({ where: { id: userId } });
    if (!user || user.refreshToken !== token) return null;
    return user;
  }

  async removeRefreshToken(userId: string): Promise<void> {
    await this.usersRepository.update({ id: userId }, { refreshToken: null });
  }
}
