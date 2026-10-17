import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  Optional,
  UnauthorizedException,
  forwardRef,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { Repository } from 'typeorm';
import { User } from '../users/user.entity';
import { UserSettings } from '../user-settings/entities/user-settings.entity';
import { AppCalendarWriteService } from '../calendar-providers/app-calendar-write.service';
import { UserIdentitiesService } from './user-identities.service';

type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  id_token?: string;
};

type GraphUser = {
  id?: string;
  mail?: string | null;
  userPrincipalName?: string | null;
  displayName?: string | null;
};

@Injectable()
export class MicrosoftAuthService {
  private readonly logger = new Logger(MicrosoftAuthService.name);
  private readonly loginTickets = new Map<
    string,
    { access_token: string; refresh_token: string; expiresAt: number }
  >();
  /** Short-lived link states: state → userId */
  private readonly linkStates = new Map<
    string,
    { userId: string; expiresAt: number }
  >();

  constructor(
    private readonly config: ConfigService,
    private readonly jwtService: JwtService,
    private readonly identities: UserIdentitiesService,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(UserSettings)
    private readonly settingsRepo: Repository<UserSettings>,
    @Optional()
    @Inject(forwardRef(() => AppCalendarWriteService))
    private readonly appWrites?: AppCalendarWriteService,
  ) {}

  isConfigured(): boolean {
    return !!(
      this.config.get<string>('MICROSOFT_CLIENT_ID')?.trim() &&
      this.config.get<string>('MICROSOFT_CLIENT_SECRET')?.trim() &&
      this.config.get<string>('MICROSOFT_REDIRECT_URI')?.trim()
    );
  }

  buildAuthorizeUrl(opts: { linkUserId?: string }): { url: string } {
    if (!this.isConfigured()) {
      throw new BadRequestException('Microsoft auth is not configured');
    }
    const clientId = this.config.get<string>('MICROSOFT_CLIENT_ID')!.trim();
    const redirectUri = this.config
      .get<string>('MICROSOFT_REDIRECT_URI')!
      .trim();
    const tenant =
      this.config.get<string>('MICROSOFT_TENANT')?.trim() || 'common';
    const scope = encodeURIComponent(
      'openid profile email offline_access User.Read Calendars.ReadWrite',
    );
    let state = 'login';
    if (opts.linkUserId) {
      state = `link_${randomBytes(16).toString('hex')}`;
      this.linkStates.set(state, {
        userId: opts.linkUserId,
        expiresAt: Date.now() + 10 * 60_000,
      });
    }
    const url =
      `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize` +
      `?client_id=${encodeURIComponent(clientId)}` +
      `&response_type=code` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&response_mode=query` +
      `&scope=${scope}` +
      `&state=${encodeURIComponent(state)}`;
    return { url };
  }

  /**
   * Exchange OAuth code. Link flow keeps the existing session (no new ticket).
   * Login flow returns a one-time ticket for the SPA callback page.
   */
  async completeSignIn(
    code: string,
    state?: string,
  ): Promise<{ mode: 'link' } | { mode: 'login'; ticket: string }> {
    const tokens = await this.exchangeCode(code);
    const profile = await this.fetchProfile(tokens.access_token);
    const providerUserId = profile.id?.trim();
    let email = (
      profile.mail ||
      profile.userPrincipalName ||
      this.emailFromIdToken(tokens.id_token) ||
      ''
    )
      .trim()
      .toLowerCase();
    if (!providerUserId || !email) {
      throw new BadRequestException(
        'Microsoft did not return an email for this account.',
      );
    }
    // Some work accounts use UPN without a usable mailbox; still accept UPN as email key.
    if (!email.includes('@')) {
      email = `${providerUserId}@microsoft.local`;
    }

    const linkUserId = this.consumeLinkState(state);
    if (linkUserId) {
      await this.linkToUser(linkUserId, providerUserId, email, tokens);
      await this.ensureSettings(linkUserId);
      await this.ensureAppCalendar(linkUserId);
      return { mode: 'link' };
    }

    const user = await this.findOrCreateUser(providerUserId, email, tokens);
    await this.ensureSettings(user.id);
    await this.ensureAppCalendar(user.id);
    const pair = this.createAppTokenPair(user.id);
    await this.userRepo.update(
      { id: user.id },
      { refreshToken: pair.refresh_token },
    );
    return { mode: 'login', ticket: this.issueLoginTicket(pair) };
  }

  redeemLoginTicket(ticket: string): {
    access_token: string;
    refresh_token: string;
  } {
    const row = this.loginTickets.get(ticket);
    this.loginTickets.delete(ticket);
    if (!row || row.expiresAt < Date.now()) {
      throw new UnauthorizedException('Sign-in session expired. Try again.');
    }
    return {
      access_token: row.access_token,
      refresh_token: row.refresh_token,
    };
  }

  private consumeLinkState(state?: string): string | null {
    if (!state?.startsWith('link_')) return null;
    const row = this.linkStates.get(state);
    this.linkStates.delete(state);
    if (!row || row.expiresAt < Date.now()) {
      // In-memory map is cleared on backend restart — ask the user to click Connect again.
      throw new BadRequestException(
        'Link session expired (server may have restarted). Open Settings and connect Microsoft again.',
      );
    }
    return row.userId;
  }

  private async exchangeCode(code: string): Promise<TokenResponse> {
    const clientId = this.config.get<string>('MICROSOFT_CLIENT_ID')!.trim();
    const clientSecret = this.config
      .get<string>('MICROSOFT_CLIENT_SECRET')!
      .trim();
    const redirectUri = this.config
      .get<string>('MICROSOFT_REDIRECT_URI')!
      .trim();
    const tenant =
      this.config.get<string>('MICROSOFT_TENANT')?.trim() || 'common';
    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      scope: 'openid profile email offline_access User.Read Calendars.ReadWrite',
    });
    const res = await fetch(
      `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      },
    );
    const json = (await res.json()) as TokenResponse & {
      error?: string;
      error_description?: string;
    };
    if (!res.ok || !json.access_token) {
      this.logger.warn(
        `Microsoft token exchange failed: ${json.error} ${json.error_description}`,
      );
      throw new BadRequestException(
        json.error_description || 'Microsoft token exchange failed',
      );
    }
    return json;
  }

  private async fetchProfile(accessToken: string): Promise<GraphUser> {
    const res = await fetch('https://graph.microsoft.com/v1.0/me', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      const text = await res.text();
      this.logger.warn(`Graph /me failed: ${res.status} ${text}`);
      throw new BadRequestException('Could not load Microsoft profile');
    }
    return (await res.json()) as GraphUser;
  }

  private emailFromIdToken(idToken?: string): string | undefined {
    if (!idToken) return undefined;
    try {
      const payload = idToken.split('.')[1];
      if (!payload) return undefined;
      const json = Buffer.from(payload, 'base64url').toString('utf8');
      const parsed = JSON.parse(json) as {
        email?: string;
        preferred_username?: string;
      };
      return parsed.email || parsed.preferred_username;
    } catch {
      return undefined;
    }
  }

  private async findOrCreateUser(
    providerUserId: string,
    email: string,
    tokens: TokenResponse,
  ): Promise<User> {
    const existingIdentity = await this.identities.findByProviderUser(
      'microsoft',
      providerUserId,
    );
    if (existingIdentity) {
      await this.identities.upsert({
        userId: existingIdentity.userId,
        provider: 'microsoft',
        providerUserId,
        email,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token ?? undefined,
        tokenExpiry: this.expiryDate(tokens.expires_in),
      });
      const user = await this.userRepo.findOne({
        where: { id: existingIdentity.userId },
      });
      if (!user) {
        throw new BadRequestException('Linked user missing');
      }
      return user;
    }

    const byEmail = await this.userRepo
      .createQueryBuilder('user')
      .where('LOWER(user.email) = LOWER(:email)', { email })
      .getOne();

    if (byEmail) {
      await this.identities.upsert({
        userId: byEmail.id,
        provider: 'microsoft',
        providerUserId,
        email,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token ?? undefined,
        tokenExpiry: this.expiryDate(tokens.expires_in),
        isRegistrationIdentity: false,
      });
      this.logger.log(
        `Linked Microsoft ${providerUserId} to existing user ${byEmail.id}`,
      );
      return byEmail;
    }

    const placeholderPassword = await bcrypt.hash(
      randomBytes(32).toString('hex'),
      10,
    );
    const created = await this.userRepo.save(
      this.userRepo.create({
        email,
        password: placeholderPassword,
        isEmailVerified: true,
      }),
    );
    await this.identities.upsert({
      userId: created.id,
      provider: 'microsoft',
      providerUserId,
      email,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? undefined,
      tokenExpiry: this.expiryDate(tokens.expires_in),
      isRegistrationIdentity: true,
    });
    this.logger.log(`Created user ${created.id} from Microsoft sign-in`);
    return created;
  }

  private async linkToUser(
    userId: string,
    providerUserId: string,
    email: string,
    tokens: TokenResponse,
  ): Promise<User> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) {
      throw new BadRequestException('User not found for link');
    }
    await this.identities.upsert({
      userId,
      provider: 'microsoft',
      providerUserId,
      email,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? undefined,
      tokenExpiry: this.expiryDate(tokens.expires_in),
    });
    return user;
  }

  private expiryDate(expiresIn?: number): Date | null {
    if (!expiresIn || expiresIn <= 0) return null;
    return new Date(Date.now() + expiresIn * 1000);
  }

  private createAppTokenPair(userId: string): {
    access_token: string;
    refresh_token: string;
  } {
    const payload = { sub: userId };
    return {
      access_token: this.jwtService.sign(payload, { expiresIn: '15m' }),
      refresh_token: this.jwtService.sign(payload, { expiresIn: '7d' }),
    };
  }

  private issueLoginTicket(pair: {
    access_token: string;
    refresh_token: string;
  }): string {
    const ticket = randomBytes(24).toString('hex');
    this.loginTickets.set(ticket, {
      ...pair,
      expiresAt: Date.now() + 120_000,
    });
    return ticket;
  }

  private async ensureAppCalendar(userId: string): Promise<void> {
    if (!this.appWrites) return;
    try {
      await this.appWrites.syncHome(userId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(
        `Could not create the Microsoft app calendar for ${userId}: ${msg}`,
      );
    }
  }

  private async ensureSettings(userId: string): Promise<void> {
    const settings = await this.settingsRepo.findOne({ where: { userId } });
    if (settings) {
      if (!settings.appCalendarProvider && !settings.googleCalendarLinked) {
        await this.settingsRepo.update(
          { userId },
          { appCalendarProvider: 'microsoft' },
        );
      }
      return;
    }
    await this.settingsRepo.save(
      this.settingsRepo.create({
        userId,
        googleCalendarLinked: false,
        wakeTime: '07:00',
        sleepTime: '22:00',
        defaultWorkBlockDuration: 25,
        defaultBreakDuration: 5,
        defaultLunchDuration: 60,
        preferredLunchTime: '12:00',
        weekendWorkEnabled: false,
        allowSplitScheduling: true,
        fixedEventBufferMinutes: 0,
        minSplitMinutes: 30,
        maxSplitMinutes: 30,
        recurringScheduleHorizonDays: 30,
        appGoogleCalendarName: 'AI Calendar Assistant',
        appCalendarProvider: 'microsoft',
      }),
    );
  }
}
