import { Test, TestingModule } from '@nestjs/testing';
import { UserSettingsController } from './user-settings.controller';
import { UserSettingsService } from './user-settings.service';
import { PhasesService } from '../phases/phases.service';

describe('UserSettingsController', () => {
  let controller: UserSettingsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UserSettingsController],
      providers: [
        {
          provide: UserSettingsService,
          useValue: {
            getSettings: jest.fn(),
            updateSettings: jest.fn(),
          },
        },
        {
          provide: PhasesService,
          useValue: {
            countForUser: jest.fn().mockResolvedValue(0),
          },
        },
      ],
    }).compile();

    controller = module.get<UserSettingsController>(UserSettingsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
