import {
  Controller,
  Get,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
  ServiceUnavailableException,
  Body,
  Param,
  BadRequestException,
  Logger,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Response } from 'express';
import { getFrontendBaseUrl } from '../../common/public-url';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { UserIdentitiesService } from './user-identities.service';
import { MicrosoftAuthService } from './microsoft-auth.service';
import { AppleCalendarProvider } from '../calendar-providers/apple-calendar.provider';
import type { CalendarProviderId } from '../calendar-providers/calendar-provider.types';

@ApiTags('auth-providers')
@Controller('auth')
export class MultiProviderAuthController {
  private readonly logger = new Logger(MultiProviderAuthController.name);

  constructor(
    private readonly config: ConfigService,
    private readonly identities: UserIdentitiesService,
    private readonly microsoftAuth: MicrosoftAuthService,
    @Inject(forwardRef(() => AppleCalendarProvider))
    private readonly appleCalendar: AppleCalendarProvider,
  ) {}

  @Get('microsoft')
  @ApiOperation({ summary: 'Microsoft sign-in URL (new session)' })
  getMicrosoftAuthUrl() {
    if (!this.microsoftAuth.isConfigured()) {
      throw new ServiceUnavailableException(
        'Microsoft auth is not configured. Set MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET, MICROSOFT_REDIRECT_URI.',
      );
    }
    return { ...this.microsoftAuth.buildAuthorizeUrl({}), configured: true };
  }

  @Get('microsoft/link')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Microsoft link URL for the logged-in user' })
  getMicrosoftLinkUrl(@Req() req) {
    if (!this.microsoftAuth.isConfigured()) {
      throw new ServiceUnavailableException(
        'Microsoft auth is not configured.',
      );
    }
    return {
      ...this.microsoftAuth.buildAuthorizeUrl({ linkUserId: req.user.userId }),
      configured: true,
    };
  }

  @Get('microsoft/callback')
  @ApiOperation({ summary: 'Microsoft OAuth callback' })
  async microsoftCallback(
    @Query('code') code: string,
    @Query('error') error: string,
    @Query('error_description') errorDescription: string,
    @Query('state') state: string,
    @Res() res: Response,
  ) {
    // Same Fastify-safe redirect pattern as GoogleCalendarController.
    const frontend = getFrontendBaseUrl();
    const redirect = (path: string) => {
      const redirectUrl = `${frontend}${path}`;
      res.status(302);
      res.header('Location', redirectUrl);
      res.header('Access-Control-Allow-Origin', frontend);
      res.header('Access-Control-Allow-Credentials', 'true');
      res.header('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.redirect(redirectUrl);
    };

    this.logger.log(
      `Microsoft OAuth callback received (state=${state || 'none'})`,
    );

    if (error) {
      const detail = errorDescription || error;
      this.logger.warn(`Microsoft OAuth error: ${detail}`);
      redirect(`/login?error=${encodeURIComponent(detail)}`);
      return;
    }
    if (!code) {
      redirect('/login?error=no_code');
      return;
    }
    try {
      const result = await this.microsoftAuth.completeSignIn(code, state);
      if (result.mode === 'link') {
        // Keep existing JWT session; land back on Settings.
        redirect('/settings?microsoft=linked');
        return;
      }
      redirect(
        `/auth/microsoft/callback?ticket=${encodeURIComponent(result.ticket)}`,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`Microsoft callback failed: ${msg}`);
      const toSettings = state?.startsWith('link_');
      redirect(
        toSettings
          ? `/settings?microsoft=error&detail=${encodeURIComponent(msg)}`
          : `/login?error=${encodeURIComponent(msg)}`,
      );
    }
  }

  @Post('microsoft/session')
  @ApiOperation({ summary: 'Exchange Microsoft one-time ticket for JWT' })
  redeemMicrosoftSession(@Body('ticket') ticket: string) {
    if (!ticket?.trim()) {
      throw new BadRequestException('ticket is required');
    }
    return this.microsoftAuth.redeemLoginTicket(ticket.trim());
  }

  @Post('apple/caldav')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Link iCloud Calendar via CalDAV (Apple ID email + app-specific password)',
  })
  async connectAppleCalDav(
    @Req() req,
    @Body() body: { appleId?: string; appSpecificPassword?: string },
  ) {
    const appleId = body?.appleId?.trim();
    const appSpecificPassword = body?.appSpecificPassword?.trim();
    if (!appleId || !appSpecificPassword) {
      throw new BadRequestException(
        'appleId and appSpecificPassword are required',
      );
    }
    const result = await this.appleCalendar.connectCalDav(
      req.user.userId,
      appleId,
      appSpecificPassword,
    );
    return { ok: true, email: result.email };
  }

  @Get('identities')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List linked sign-in / calendar identities' })
  async listIdentities(@Req() req) {
    const rows = await this.identities.listForUser(req.user.userId);
    // Never expose tokens to the client.
    return rows.map((r) => ({
      id: r.id,
      provider: r.provider,
      email: r.email,
      isRegistrationIdentity: r.isRegistrationIdentity,
      connected: !!(r.accessToken || r.refreshToken),
      createdAt: r.createdAt,
    }));
  }

  @Post('identities/:provider/disconnect')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Disconnect a linked provider identity' })
  async disconnect(
    @Req() req,
    @Param('provider') provider: string,
    @Body() body: { confirm?: boolean; deleteOverlays?: boolean },
  ) {
    if (!body?.confirm) {
      throw new BadRequestException(
        'Pass confirm:true after the user chooses what to do with linked data',
      );
    }
    const id = provider as CalendarProviderId;
    if (id !== 'google' && id !== 'microsoft' && id !== 'apple') {
      throw new BadRequestException('Unknown provider');
    }
    await this.identities.disconnect(req.user.userId, id);
    return { ok: true, deleteOverlays: !!body.deleteOverlays };
  }

  @Get('providers/status')
  @ApiOperation({
    summary:
      'Which providers are available (Google/Microsoft OAuth; Apple CalDAV always)',
  })
  providersStatus() {
    return {
      google: !!this.config.get<string>('GOOGLE_CLIENT_ID')?.trim(),
      microsoft: this.microsoftAuth.isConfigured(),
      // iCloud CalDAV uses per-user app-specific passwords — no server Apple OAuth.
      apple: true,
    };
  }
}
