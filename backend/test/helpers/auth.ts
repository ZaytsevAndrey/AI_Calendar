import { randomUUID } from 'crypto';
import { getRepositoryToken } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Repository } from 'typeorm';
import { User } from '../../src/modules/users/user.entity';
import { AuthService } from '../../src/modules/auth/auth.service';
import { api } from './http';

export type SeededUser = {
  user: User;
  token: string;
};

export async function seedUser(app: NestFastifyApplication): Promise<SeededUser> {
  const users = app.get<Repository<User>>(getRepositoryToken(User));
  const id = randomUUID();
  const user = await users.save(
    users.create({
      email: `e2e-${id}@test.local`,
      username: `e2e-${id}`,
      password: 'unused-google-only',
      isEmailVerified: true,
    }),
  );
  const jwt = app.get(JwtService);
  const token = jwt.sign({ sub: user.id, username: user.username });
  return { user, token };
}

/** Settings row + Google linked flag + default phases (P0 onboarded user). */
export async function seedOnboardedUser(
  app: NestFastifyApplication,
): Promise<SeededUser> {
  const seeded = await seedUser(app);
  const settingsRes = await api(app, 'GET', '/user-settings', {
    token: seeded.token,
  });
  if (settingsRes.statusCode !== 200) {
    throw new Error(`GET /user-settings failed: ${settingsRes.payload}`);
  }

  const patchRes = await api(app, 'PATCH', '/user-settings', {
    token: seeded.token,
    payload: {
      timeZone: 'Europe/Kyiv',
      googleCalendarLinked: true,
      weekendWorkEnabled: true,
      recurringScheduleHorizonDays: 14,
    },
  });
  if (patchRes.statusCode !== 200) {
    throw new Error(`PATCH /user-settings failed: ${patchRes.payload}`);
  }

  const phasesRes = await api(app, 'POST', '/phases/setup-defaults', {
    token: seeded.token,
    payload: {},
  });
  if (phasesRes.statusCode !== 201 && phasesRes.statusCode !== 200) {
    throw new Error(
      `POST /phases/setup-defaults failed: ${phasesRes.statusCode} ${phasesRes.payload}`,
    );
  }

  return seeded;
}

export async function seedRefreshSession(
  app: NestFastifyApplication,
  user: User,
): Promise<{ access_token: string; refresh_token: string }> {
  const auth = app.get(AuthService);
  const tokens = auth.createTokenPair(user.id);
  const users = app.get<Repository<User>>(getRepositoryToken(User));
  await users.update({ id: user.id }, { refreshToken: tokens.refresh_token });
  return tokens;
}

export async function createTimePhase(
  app: NestFastifyApplication,
  token: string,
  overrides?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const res = await api(app, 'POST', '/phases', {
    token,
    payload: {
      name: 'Deep work',
      color: '#2980b9',
      startTime: '09:00',
      endTime: '17:00',
      type: 'time_phase',
      ...overrides,
    },
  });
  if (res.statusCode !== 201 && res.statusCode !== 200) {
    throw new Error(`POST /phases failed: ${res.statusCode} ${res.payload}`);
  }
  return res.json() as Record<string, unknown>;
}
