import { Injectable, Logger } from '@nestjs/common';
import { GroqClient } from '../voice/groq.client';
import {
  fallbackHabitStreakTip,
  HabitStreakTipId,
  habitStreakTipSystemPrompt,
  habitStreakTipUserPayload,
  parseHabitStreakTip,
} from './habit-streak-tip.util';

@Injectable()
export class HabitStreakTipService {
  private readonly logger = new Logger(HabitStreakTipService.name);

  constructor(private readonly groq: GroqClient) {}

  async tip(input: {
    name: string;
    description: string | null;
    tipId: HabitStreakTipId;
    language?: string;
  }): Promise<string> {
    const language = input.language ?? 'en';
    const fallback = fallbackHabitStreakTip(
      input.name,
      input.tipId,
      language,
    );
    try {
      const raw = await this.groq.completeJson(
        habitStreakTipSystemPrompt(language),
        habitStreakTipUserPayload({
          name: input.name,
          description: input.description,
          tipId: input.tipId,
        }),
      );
      return parseHabitStreakTip(raw, fallback);
    } catch (e: any) {
      this.logger.warn(
        `Habit streak tip fell back to template: ${e?.message ?? e}`,
      );
      return fallback;
    }
  }
}
