import { Test, TestingModule } from '@nestjs/testing';
import { GroqClient } from '../voice/groq.client';
import { HabitStreakTipService } from './habit-streak-tip.service';

describe('HabitStreakTipService', () => {
  let service: HabitStreakTipService;
  const groq = { completeJson: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HabitStreakTipService,
        { provide: GroqClient, useValue: groq },
      ],
    }).compile();
    service = module.get(HabitStreakTipService);
  });

  it('returns the Groq tip when JSON parses', async () => {
    groq.completeJson.mockResolvedValue('{"tip":"Keep the stretch going."}');
    await expect(
      service.tip({
        name: 'Yoga',
        description: null,
        tipId: 'streak_3',
        language: 'en',
      }),
    ).resolves.toBe('Keep the stretch going.');
  });

  it('falls back when Groq fails', async () => {
    groq.completeJson.mockRejectedValue(new Error('down'));
    const tip = await service.tip({
      name: 'Yoga',
      description: null,
      tipId: 'streak_3',
      language: 'en',
    });
    expect(tip).toContain('Yoga');
    expect(tip.toLowerCase()).toContain('three');
  });
});
