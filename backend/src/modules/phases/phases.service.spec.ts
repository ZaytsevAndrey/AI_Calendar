import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException } from '@nestjs/common';
import { PhasesService } from './phases.service';
import { Phase } from './entities/phase.entity';
import { UserSettings } from '../user-settings/entities/user-settings.entity';

describe('PhasesService', () => {
  let service: PhasesService;

  const phaseRepositoryMock = {
    count: jest.fn(),
    create: jest.fn((x) => x),
    save: jest.fn((x) => Promise.resolve(x)),
    find: jest.fn(),
    findOne: jest.fn(),
    merge: jest.fn(),
    remove: jest.fn(),
    createQueryBuilder: jest.fn(),
  };

  const userSettingsRepositoryMock = {
    findOne: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PhasesService,
        {
          provide: getRepositoryToken(Phase),
          useValue: phaseRepositoryMock,
        },
        {
          provide: getRepositoryToken(UserSettings),
          useValue: userSettingsRepositoryMock,
        },
      ],
    }).compile();

    service = module.get<PhasesService>(PhasesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('setupDefaultPhases throws when user already has phases', async () => {
    phaseRepositoryMock.count.mockResolvedValue(2);
    await expect(service.setupDefaultPhases('user-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(userSettingsRepositoryMock.findOne).not.toHaveBeenCalled();
  });
});
