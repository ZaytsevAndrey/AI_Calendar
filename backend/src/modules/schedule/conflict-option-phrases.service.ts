import { Injectable, Logger } from '@nestjs/common';
import { GroqClient } from '../voice/groq.client';
import type { SchedulingConflict } from './intelligent-scheduling.engine';
import {
  ConflictOptionPhrase,
  conflictPhrasingSystemPrompt,
  conflictPhrasingUserPayload,
  fallbackConflictOptionPhrases,
  parseConflictOptionPhrases,
} from './conflict-option-phrases.util';

@Injectable()
export class ConflictOptionPhrasesService {
  private readonly logger = new Logger(ConflictOptionPhrasesService.name);

  constructor(private readonly groq: GroqClient) {}

  async phrase(conflict: SchedulingConflict): Promise<ConflictOptionPhrase[]> {
    const fallback = fallbackConflictOptionPhrases(conflict);
    try {
      const raw = await this.groq.completeJson(
        conflictPhrasingSystemPrompt(),
        conflictPhrasingUserPayload(conflict),
      );
      return parseConflictOptionPhrases(raw, conflict);
    } catch (e: any) {
      this.logger.warn(
        `Conflict option phrasing fell back to templates: ${e?.message ?? e}`,
      );
      return fallback;
    }
  }
}
