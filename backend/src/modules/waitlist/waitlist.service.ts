import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes } from 'crypto';
import { Repository } from 'typeorm';
import { isUniqueViolation } from '../../database/unique-violation';
import { WaitlistEntry } from './waitlist-entry.entity';

export const WAITLIST_LOCALES = ['uk', 'en'] as const;
export const WAITLIST_CALENDARS = ['google', 'outlook', 'icloud', 'none'] as const;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const SOURCE_RE = /^[a-z0-9-]{1,32}$/;

export interface JoinInput {
  email?: unknown;
  locale?: unknown;
  source?: unknown;
  /** Honeypot: a hidden field people never fill. */
  website?: unknown;
}

export interface DetailsInput {
  token?: unknown;
  calendar?: unknown;
  pain?: unknown;
}

export type JoinResult = { status: 'created' | 'exists'; token: string };

export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !EMAIL_RE.test(email)) return null;
  return email;
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

@Injectable()
export class WaitlistService {
  private readonly logger = new Logger(WaitlistService.name);

  constructor(
    @InjectRepository(WaitlistEntry)
    private readonly entries: Repository<WaitlistEntry>,
  ) {}

  /**
   * Adds an email to the waiting list, or says it is already there. Either way returns a fresh
   * one-time token for the optional follow-up answers.
   */
  async join(input: JoinInput): Promise<JoinResult> {
    const token = randomBytes(24).toString('hex');

    // A bot filled the hidden field: answer like a success, store nothing.
    if (typeof input.website === 'string' && input.website.trim() !== '') {
      return { status: 'created', token };
    }

    const email = normalizeEmail(input.email);
    if (!email) throw new BadRequestException('A valid email is required');

    const locale = (WAITLIST_LOCALES as readonly string[]).includes(String(input.locale))
      ? String(input.locale)
      : 'uk';
    const source = typeof input.source === 'string' && SOURCE_RE.test(input.source) ? input.source : null;
    const tokenHash = hashToken(token);

    const existing = await this.entries.findOne({ where: { email } });
    if (existing) {
      await this.entries.update({ id: existing.id }, { tokenHash });
      return { status: 'exists', token };
    }

    try {
      await this.entries.insert({ email, locale, source, tokenHash });
    } catch (e) {
      // Two requests for the same email at once: the other one won.
      if (!isUniqueViolation(e)) throw e;
      await this.entries.update({ email }, { tokenHash });
      return { status: 'exists', token };
    }
    this.logger.log(`Waitlist: new request (${locale}, ${source ?? 'no source'})`);
    return { status: 'created', token };
  }

  /** Stores the optional follow-up answers for the request the token belongs to. */
  async details(input: DetailsInput): Promise<void> {
    if (typeof input.token !== 'string' || !/^[a-f0-9]{48}$/.test(input.token)) {
      throw new BadRequestException('token is required');
    }
    const entry = await this.entries.findOne({ where: { tokenHash: hashToken(input.token) } });
    if (!entry) throw new NotFoundException('Unknown or expired token');

    const calendar = (WAITLIST_CALENDARS as readonly string[]).includes(String(input.calendar))
      ? String(input.calendar)
      : null;
    const pain = typeof input.pain === 'string' ? input.pain.trim().slice(0, 500) || null : null;

    await this.entries.update(
      { id: entry.id },
      {
        calendar: calendar ?? entry.calendar,
        pain: pain ?? entry.pain,
        detailsAt: new Date(),
        // One use: a leaked token cannot overwrite the answers later.
        tokenHash: null,
      },
    );
  }
}
