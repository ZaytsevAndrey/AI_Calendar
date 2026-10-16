import {
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { resolveIanaTimeZone } from '../../common/iana-time-zone';
import { UserSettingsService } from '../user-settings/user-settings.service';
import { VoiceDailyUsage } from './entities/voice-daily-usage.entity';
import { localYmd } from './voice-local-date.util';

/** Starting free-tier ceiling while voice has no subscription. */
export const DEFAULT_VOICE_DAILY_TOKEN_LIMIT = 100_000;

@Injectable()
export class VoiceQuotaService {
  constructor(
    private readonly config: ConfigService,
    private readonly userSettingsService: UserSettingsService,
    @InjectRepository(VoiceDailyUsage)
    private readonly usageRepository: Repository<VoiceDailyUsage>,
  ) {}

  dailyLimit(): number {
    const raw = this.config.get<string>('VOICE_DAILY_TOKEN_LIMIT')?.trim();
    if (!raw) return DEFAULT_VOICE_DAILY_TOKEN_LIMIT;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) return DEFAULT_VOICE_DAILY_TOKEN_LIMIT;
    return Math.floor(value);
  }

  async civilDayYmd(userId: string, nowIso = new Date().toISOString()): Promise<string> {
    const settings = await this.userSettingsService.getSettings(userId);
    const timeZone = resolveIanaTimeZone(settings.timeZone || 'UTC');
    return localYmd(nowIso, timeZone);
  }

  async tokensUsedToday(userId: string, dayYmd?: string): Promise<number> {
    const day = dayYmd || (await this.civilDayYmd(userId));
    const row = await this.usageRepository.findOne({ where: { userId, dayYmd: day } });
    return row?.tokensUsed ?? 0;
  }

  async assertUnderLimit(userId: string): Promise<void> {
    const limit = this.dailyLimit();
    if (limit <= 0) return;
    const dayYmd = await this.civilDayYmd(userId);
    const used = await this.tokensUsedToday(userId, dayYmd);
    if (used >= limit) {
      throw new HttpException(
        {
          code: 'VOICE_QUOTA_EXCEEDED',
          message: 'Daily voice limit reached. Try again tomorrow.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  async addTokens(userId: string, tokens: number): Promise<void> {
    const n = Math.floor(tokens);
    if (!Number.isFinite(n) || n <= 0) return;
    const dayYmd = await this.civilDayYmd(userId);
    const existing = await this.usageRepository.findOne({
      where: { userId, dayYmd },
    });
    if (existing) {
      existing.tokensUsed += n;
      await this.usageRepository.save(existing);
      return;
    }
    await this.usageRepository.save(
      this.usageRepository.create({ userId, dayYmd, tokensUsed: n }),
    );
  }
}
