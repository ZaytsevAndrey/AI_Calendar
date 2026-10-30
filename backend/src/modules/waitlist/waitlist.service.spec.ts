import { BadRequestException, NotFoundException } from '@nestjs/common';
import { RateLimiter } from './rate-limit';
import { WaitlistEntry } from './waitlist-entry.entity';
import { WaitlistService, hashToken, normalizeEmail } from './waitlist.service';

/** Minimal in-memory stand-in for Repository<WaitlistEntry>. */
function fakeRepo() {
  const rows: WaitlistEntry[] = [];
  const matches = (row: WaitlistEntry, where: Partial<WaitlistEntry>) =>
    Object.entries(where).every(([k, v]) => (row as any)[k] === v);
  return {
    rows,
    findOne: jest.fn(async ({ where }: { where: Partial<WaitlistEntry> }) => rows.find((r) => matches(r, where)) ?? null),
    insert: jest.fn(async (value: Partial<WaitlistEntry>) => {
      if (rows.some((r) => r.email === value.email)) {
        throw Object.assign(new Error('duplicate'), { code: '23505' });
      }
      rows.push({
        id: `id-${rows.length + 1}`,
        source: null,
        calendar: null,
        pain: null,
        tokenHash: null,
        detailsAt: null,
        invitedAt: null,
        createdAt: new Date(),
        ...value,
      } as WaitlistEntry);
    }),
    update: jest.fn(async (where: Partial<WaitlistEntry>, patch: Partial<WaitlistEntry>) => {
      rows.filter((r) => matches(r, where)).forEach((r) => Object.assign(r, patch));
    }),
  };
}

function setup() {
  const repo = fakeRepo();
  const service = new WaitlistService(repo as any);
  return { repo, service };
}

describe('normalizeEmail', () => {
  it('trims and lowercases a valid email', () => {
    expect(normalizeEmail('  Name@Example.COM ')).toBe('name@example.com');
  });

  it.each([undefined, 42, '', 'no-at-sign', 'a@b', 'a b@c.com', `${'x'.repeat(250)}@a.com`])(
    'rejects %p',
    (value) => {
      expect(normalizeEmail(value)).toBeNull();
    },
  );
});

describe('WaitlistService.join', () => {
  it('stores a new email with its locale and source and returns a token', async () => {
    const { repo, service } = setup();
    const res = await service.join({ email: 'Ann@Example.com', locale: 'en', source: 'hero' });

    expect(res.status).toBe('created');
    expect(res.token).toMatch(/^[a-f0-9]{48}$/);
    expect(repo.rows).toHaveLength(1);
    expect(repo.rows[0]).toMatchObject({
      email: 'ann@example.com',
      locale: 'en',
      source: 'hero',
      tokenHash: hashToken(res.token),
    });
  });

  it('falls back to uk and drops an odd source', async () => {
    const { repo, service } = setup();
    await service.join({ email: 'a@b.co', locale: 'fr', source: '<script>' });
    expect(repo.rows[0]).toMatchObject({ locale: 'uk', source: null });
  });

  it('answers "exists" for a known email and issues a new token', async () => {
    const { repo, service } = setup();
    const first = await service.join({ email: 'a@b.co' });
    const second = await service.join({ email: 'A@B.co' });

    expect(second.status).toBe('exists');
    expect(repo.rows).toHaveLength(1);
    expect(repo.rows[0].tokenHash).toBe(hashToken(second.token));
    expect(second.token).not.toBe(first.token);
  });

  it('treats a concurrent duplicate insert as "exists"', async () => {
    const { repo, service } = setup();
    await service.join({ email: 'a@b.co' });
    repo.findOne.mockResolvedValueOnce(null); // the other request inserted in between
    const res = await service.join({ email: 'a@b.co' });
    expect(res.status).toBe('exists');
    expect(repo.rows).toHaveLength(1);
  });

  it('rejects an invalid email', async () => {
    const { service } = setup();
    await expect(service.join({ email: 'nope' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('stores nothing when the honeypot is filled, but looks like a success', async () => {
    const { repo, service } = setup();
    const res = await service.join({ email: 'bot@spam.com', website: 'http://spam' });
    expect(res.status).toBe('created');
    expect(repo.rows).toHaveLength(0);
  });
});

describe('WaitlistService.details', () => {
  it('saves the answers once and burns the token', async () => {
    const { repo, service } = setup();
    const { token } = await service.join({ email: 'a@b.co' });

    await service.details({ token, calendar: 'outlook', pain: '  Payments  ' });
    expect(repo.rows[0]).toMatchObject({ calendar: 'outlook', pain: 'Payments', tokenHash: null });
    expect(repo.rows[0].detailsAt).toBeInstanceOf(Date);

    await expect(service.details({ token, calendar: 'google' })).rejects.toBeInstanceOf(NotFoundException);
    expect(repo.rows[0].calendar).toBe('outlook');
  });

  it('ignores an unknown calendar value and cuts long text', async () => {
    const { repo, service } = setup();
    const { token } = await service.join({ email: 'a@b.co' });
    await service.details({ token, calendar: 'notion', pain: 'x'.repeat(900) });
    expect(repo.rows[0].calendar).toBeNull();
    expect(repo.rows[0].pain).toHaveLength(500);
  });

  it('rejects a malformed token', async () => {
    const { service } = setup();
    await expect(service.details({ token: 'abc' })).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('RateLimiter', () => {
  it('allows `limit` calls per window and resets after it', () => {
    let now = 0;
    const limiter = new RateLimiter(2, 1000, () => now);
    expect(limiter.take('ip')).toBe(true);
    expect(limiter.take('ip')).toBe(true);
    expect(limiter.take('ip')).toBe(false);
    expect(limiter.take('other')).toBe(true);
    now = 1000;
    expect(limiter.take('ip')).toBe(true);
  });
});
