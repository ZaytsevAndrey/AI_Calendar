import { Test, TestingModule } from '@nestjs/testing';
import { UserSettingsService } from '../src/modules/user-settings/user-settings.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { UserSettings } from '../src/modules/user-settings/entities/user-settings.entity';
import { Repository } from 'typeorm';

describe('UserSettingsService', () => {
  let service: UserSettingsService;
  let userSettingsRepository: Repository<UserSettings>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserSettingsService,
        {
          provide: getRepositoryToken(UserSettings),
          useClass: Repository,
        },
      ],
    }).compile();

    service = module.get<UserSettingsService>(UserSettingsService);
    userSettingsRepository = module.get<Repository<UserSettings>>(
      getRepositoryToken(UserSettings),
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should get user settings', async () => {
    const userId = '1';
    const settings = {
      id: '1',
      userId,
      theme: 'light',
      language: 'en',
      notifications: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    jest
      .spyOn(userSettingsRepository, 'findOne')
      .mockResolvedValue(settings as UserSettings);

    const result = await service.getSettings(userId);
    expect(result).toEqual(settings);
    expect(userSettingsRepository.findOne).toHaveBeenCalledWith({
      where: { userId },
    });
  });

  it('should update user settings', async () => {
    const userId = '1';
    const updateSettingsDto = {
      theme: 'dark',
      language: 'uk',
      notifications: false,
    };

    jest
      .spyOn(userSettingsRepository, 'update')
      .mockResolvedValue({ affected: 1, raw: [], generatedMaps: [] });

    await service.updateSettings(userId, updateSettingsDto);
    expect(userSettingsRepository.update).toHaveBeenCalledWith(
      { userId },
      updateSettingsDto,
    );
  });

  it('should create default settings', async () => {
    const userId = '1';
    const defaultSettings = {
      id: '1',
      userId,
      theme: 'light',
      language: 'en',
      notifications: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    jest
      .spyOn(userSettingsRepository, 'save')
      .mockResolvedValue(defaultSettings as UserSettings);

    const result = await service.createDefaultSettings(userId);
    expect(result).toEqual(defaultSettings);
    expect(userSettingsRepository.save).toHaveBeenCalledWith({
      userId,
      theme: 'light',
      language: 'en',
      notifications: true,
    });
  });
});
