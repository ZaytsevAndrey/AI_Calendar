import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { UserSettingsService } from './user-settings.service';
import { UserSettings } from './entities/user-settings.entity';

describe('UserSettingsService', () => {
  let service: UserSettingsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserSettingsService,
        {
          provide: getRepositoryToken(UserSettings),
          useValue: {
            findOne: jest.fn(),
            create: jest.fn(),
            save: jest.fn(),
            merge: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<UserSettingsService>(UserSettingsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
