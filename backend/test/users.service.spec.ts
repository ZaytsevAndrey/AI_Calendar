import { Test, TestingModule } from '@nestjs/testing';
import { UsersService } from '../src/modules/users/users.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { User } from '../src/modules/users/user.entity';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';

jest.mock('bcryptjs');

describe('UsersService', () => {
  let service: UsersService;
  let usersRepository: Repository<User>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        {
          provide: getRepositoryToken(User),
          useClass: Repository,
        },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
    usersRepository = module.get<Repository<User>>(getRepositoryToken(User));
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should find one user by email', async () => {
    const email = 'test@example.com';
    const user = {
      id: '1',
      email,
      username: 'testuser',
      password: 'hashedPassword',
      resetToken: null,
      refreshToken: null,
      googleAccessToken: null,
      googleRefreshToken: null,
      googleTokenExpiry: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    jest.spyOn(usersRepository, 'findOne').mockResolvedValue(user as User);

    const result = await service.findOne(email);
    expect(result).toEqual(user);
    expect(usersRepository.findOne).toHaveBeenCalledWith({ where: { email } });
  });

  it('should create a new user', async () => {
    const createUserDto = {
      email: 'test@example.com',
      password: 'password123',
    };
    const hashedPassword = 'hashedPassword';
    const savedUser = {
      id: '1',
      ...createUserDto,
      password: hashedPassword,
      username: 'testuser',
      resetToken: null,
      refreshToken: null,
      googleAccessToken: null,
      googleRefreshToken: null,
      googleTokenExpiry: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    (bcrypt.hash as jest.Mock).mockResolvedValue(hashedPassword);
    jest.spyOn(usersRepository, 'save').mockResolvedValue(savedUser as User);

    const result = await service.create(createUserDto);
    expect(result).toEqual(savedUser);
    expect(bcrypt.hash).toHaveBeenCalledWith(createUserDto.password, 10);
  });

  it('should find user by id', async () => {
    const id = '1';
    const user = {
      id,
      email: 'test@example.com',
      username: 'testuser',
      password: 'hashedPassword',
      resetToken: null,
      refreshToken: null,
      googleAccessToken: null,
      googleRefreshToken: null,
      googleTokenExpiry: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    jest.spyOn(usersRepository, 'findOne').mockResolvedValue(user as User);

    const result = await service.findById(id);
    expect(result).toEqual(user);
    expect(usersRepository.findOne).toHaveBeenCalledWith({ where: { id } });
  });

  it('should update user password', async () => {
    const id = '1';
    const newPassword = 'newPassword123';
    const hashedPassword = 'hashedNewPassword';

    (bcrypt.hash as jest.Mock).mockResolvedValue(hashedPassword);
    jest
      .spyOn(usersRepository, 'update')
      .mockResolvedValue({ affected: 1, raw: [], generatedMaps: [] });

    await service.updatePassword(id, newPassword);
    expect(bcrypt.hash).toHaveBeenCalledWith(newPassword, 10);
    expect(usersRepository.update).toHaveBeenCalledWith(id, {
      password: hashedPassword,
    });
  });

  it('should set refresh token', async () => {
    const id = '1';
    const refreshToken = 'refresh-token';
    const hashedToken = 'hashed-token';

    (bcrypt.hash as jest.Mock).mockResolvedValue(hashedToken);
    jest
      .spyOn(usersRepository, 'update')
      .mockResolvedValue({ affected: 1, raw: [], generatedMaps: [] });

    await service.setRefreshToken(id, refreshToken);
    expect(bcrypt.hash).toHaveBeenCalledWith(refreshToken, 10);
    expect(usersRepository.update).toHaveBeenCalledWith(id, {
      refreshToken: hashedToken,
    });
  });

  it('should get user if refresh token matches', async () => {
    const id = '1';
    const refreshToken = 'refresh-token';
    const hashedToken = 'hashed-token';
    const user = {
      id,
      refreshToken: hashedToken,
      email: 'test@example.com',
      username: 'testuser',
      password: 'hashedPassword',
      resetToken: null,
      googleAccessToken: null,
      googleRefreshToken: null,
      googleTokenExpiry: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    jest.spyOn(usersRepository, 'findOne').mockResolvedValue(user as User);
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);

    const result = await service.getUserIfRefreshTokenMatches(id, refreshToken);
    expect(result).toEqual(user);
    expect(bcrypt.compare).toHaveBeenCalledWith(refreshToken, hashedToken);
  });

  it('should remove refresh token', async () => {
    const id = '1';
    jest
      .spyOn(usersRepository, 'update')
      .mockResolvedValue({ affected: 1, raw: [], generatedMaps: [] });

    await service.removeRefreshToken(id);
    expect(usersRepository.update).toHaveBeenCalledWith(id, {
      refreshToken: null,
    });
  });
});
