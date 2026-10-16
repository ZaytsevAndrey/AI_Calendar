import { HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { UserSettingsService } from '../user-settings/user-settings.service';
import { VoiceDailyUsage } from './entities/voice-daily-usage.entity';
import {
  DEFAULT_VOICE_DAILY_TOKEN_LIMIT,
  VoiceQuotaService,
} from './voice-quota.service';

describe('VoiceQuotaService', () => {
  function build(opts?: {
    limit?: string;
    timeZone?: string | null;
    row?: VoiceDailyUsage | null;
  }) {
    const saved: VoiceDailyUsage[] = [];
    const usageRepository = {
      findOne: jest.fn(async ({ where }: { where: { userId: string; dayYmd: string } }) => {
        if (opts?.row && opts.row.userId === where.userId && opts.row.dayYmd === where.dayYmd) {
          return opts.row;
        }
        return (
          saved.find((r) => r.userId === where.userId && r.dayYmd === where.dayYmd) ?? null
        );
      }),
      create: jest.fn((data: Partial<VoiceDailyUsage>) => ({ ...data })),
      save: jest.fn(async (row: VoiceDailyUsage) => {
        const existing = saved.findIndex(
          (r) => r.userId === row.userId && r.dayYmd === row.dayYmd,
        );
        if (existing >= 0) saved[existing] = row;
        else saved.push(row);
        return row;
      }),
    } as unknown as Repository<VoiceDailyUsage>;

    const service = new VoiceQuotaService(
      {
        get: (key: string) =>
          key === 'VOICE_DAILY_TOKEN_LIMIT' ? opts?.limit : undefined,
      } as ConfigService,
      {
        getSettings: jest.fn(async () => ({
          timeZone: opts?.timeZone ?? 'UTC',
        })),
      } as unknown as UserSettingsService,
      usageRepository,
    );
    return { service, usageRepository, saved };
  }

  it('defaults the daily limit to 100000', () => {
    expect(build().service.dailyLimit()).toBe(DEFAULT_VOICE_DAILY_TOKEN_LIMIT);
  });

  it('blocks when used tokens meet the daily ceiling', async () => {
    const { service } = build({
      limit: '100',
      row: {
        id: '1',
        userId: 'u1',
        dayYmd: '2026-10-16',
        tokensUsed: 100,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    jest.spyOn(service, 'civilDayYmd').mockResolvedValue('2026-10-16');
    await expect(service.assertUnderLimit('u1')).rejects.toBeInstanceOf(HttpException);
    await expect(service.assertUnderLimit('u1')).rejects.toMatchObject({
      response: { code: 'VOICE_QUOTA_EXCEEDED' },
    });
  });

  it('allows a turn under the ceiling and accumulates tokens', async () => {
    const { service, saved } = build({ limit: '1000' });
    jest.spyOn(service, 'civilDayYmd').mockResolvedValue('2026-10-16');
    await expect(service.assertUnderLimit('u1')).resolves.toBeUndefined();
    await service.addTokens('u1', 40);
    await service.addTokens('u1', 15);
    expect(saved[0]?.tokensUsed).toBe(55);
  });

  it('treats a new civil day as a fresh quota', async () => {
    const { service } = build({
      limit: '50',
      row: {
        id: '1',
        userId: 'u1',
        dayYmd: '2026-10-15',
        tokensUsed: 50,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    jest.spyOn(service, 'civilDayYmd').mockResolvedValue('2026-10-16');
    await expect(service.assertUnderLimit('u1')).resolves.toBeUndefined();
  });
});
