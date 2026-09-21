import { mkdirSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AuthService } from '../modules/auth/auth.service';
import { Phase } from '../modules/phases/entities/phase.entity';
import { PhasesService } from '../modules/phases/phases.service';
import { User } from '../modules/users/user.entity';
import { UserSettings } from '../modules/user-settings/entities/user-settings.entity';

export type PlaywrightAuthFile = {
  onboarded: { access_token: string; refresh_token: string };
  needsSettings: { access_token: string; refresh_token: string };
  needsPhases: { access_token: string; refresh_token: string };
};

type SeedOpts = {
  email: string;
  username: string;
  linked: boolean;
  phases: boolean;
};

/**
 * Gated by E2E_BOOTSTRAP=1. Seeds JWT users for Playwright and writes E2E_AUTH_FILE.
 * Not a production login path.
 */
export async function bootstrapPlaywrightUsers(
  app: INestApplication,
): Promise<void> {
  if (process.env.E2E_BOOTSTRAP !== '1') {
    return;
  }

  const authFile = process.env.E2E_AUTH_FILE;
  if (!authFile) {
    throw new Error('E2E_BOOTSTRAP=1 requires E2E_AUTH_FILE');
  }

  const ds = app.get(DataSource);
  const auth = app.get(AuthService);
  const phasesService = app.get(PhasesService);
  const users = ds.getRepository(User);
  const settings = ds.getRepository(UserSettings);
  const phases = ds.getRepository(Phase);

  const seed = async (opts: SeedOpts) => {
    let user = await users.findOne({ where: { email: opts.email } });
    if (!user) {
      user = await users.save(
        users.create({
          email: opts.email,
          username: opts.username,
          password: 'unused-google-only',
          isEmailVerified: true,
        }),
      );
    }

    let row = await settings.findOne({ where: { userId: user.id } });
    if (!row) {
      row = settings.create({
        userId: user.id,
        wakeTime: '08:00',
        sleepTime: '23:00',
        timeZone: 'Europe/Kyiv',
        googleCalendarLinked: opts.linked,
        weekendWorkEnabled: true,
        recurringScheduleHorizonDays: 14,
      });
    } else {
      row.wakeTime = row.wakeTime || '08:00';
      row.sleepTime = row.sleepTime || '23:00';
      row.timeZone = 'Europe/Kyiv';
      row.googleCalendarLinked = opts.linked;
      row.weekendWorkEnabled = true;
    }
    row = await settings.save(row);

    if (opts.phases) {
      await phasesService.ensureDefaultPhasesForUser(
        user.id,
        row.wakeTime,
        row.sleepTime,
      );
    } else {
      await phases.delete({ userId: user.id });
    }

    const tokens = auth.createTokenPair(user.id);
    await users.update({ id: user.id }, { refreshToken: tokens.refresh_token });
    return tokens;
  };

  const payload: PlaywrightAuthFile = {
    onboarded: await seed({
      email: 'playwright-onboarded@test.local',
      username: 'playwright-onboarded',
      linked: true,
      phases: true,
    }),
    needsSettings: await seed({
      email: 'playwright-settings@test.local',
      username: 'playwright-settings',
      linked: false,
      phases: false,
    }),
    needsPhases: await seed({
      email: 'playwright-phases@test.local',
      username: 'playwright-phases',
      linked: true,
      phases: false,
    }),
  };

  mkdirSync(dirname(authFile), { recursive: true });
  writeFileSync(authFile, JSON.stringify(payload, null, 2), 'utf8');
}
