import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
  Res,
  Logger,
} from '@nestjs/common';
import { GoogleCalendarService } from './google-calendar.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Response } from 'express';
import { getFrontendBaseUrl } from '../../common/public-url';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';

@ApiTags('google-calendar')
@Controller('google-calendar')
export class GoogleCalendarController {
  private readonly logger = new Logger(GoogleCalendarController.name);

  constructor(private readonly googleCalendarService: GoogleCalendarService) {}

  @Get('auth-url')
  @ApiOperation({ summary: 'Google sign-in URL (calendar scopes included)' })
  @ApiResponse({ status: 200, description: 'Return the authorization URL.' })
  getAuthUrl() {
    return { url: this.googleCalendarService.getLoginAuthUrl() };
  }

  @Get('callback')
  @ApiOperation({ summary: 'Handle Google OAuth callback' })
  @ApiResponse({
    status: 200,
    description: 'OAuth callback handled successfully.',
  })
  async handleCallback(
    @Query('code') code: string,
    @Query('error') error: string,
    @Res() res: Response,
  ) {
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

    this.logger.log('Google OAuth callback received');

    if (error) {
      this.logger.error(`Google OAuth error: ${error}`);
      redirect(`/login?error=${encodeURIComponent(error)}`);
      return;
    }

    if (!code) {
      this.logger.error('No authorization code received');
      redirect('/login?error=no_code');
      return;
    }

    try {
      const ticket = await this.googleCalendarService.completeGoogleSignIn(code);
      redirect(`/auth/google/callback?ticket=${encodeURIComponent(ticket)}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'sign_in_failed';
      this.logger.error(`Error processing Google OAuth callback: ${msg}`);
      redirect(`/login?error=${encodeURIComponent(msg)}`);
    }
  }

  @Post('save-token')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Save Google Calendar token' })
  @ApiResponse({ status: 200, description: 'Token saved successfully.' })
  async saveToken(@Req() req, @Body('code') code: string) {
    this.logger.log(`Saving token for user ${req.user.userId}`);
    return this.googleCalendarService.saveToken(code, req.user.userId);
  }

  @Get('check-connection')
  @UseGuards(JwtAuthGuard)
  async checkConnection(@Req() req) {
    return this.googleCalendarService.checkConnection(req.user.userId);
  }

  @Get('check-all-users')
  @ApiOperation({ summary: 'Check all users with Google tokens' })
  @ApiResponse({ status: 200, description: 'List of users with tokens.' })
  async checkAllUsers() {
    return this.googleCalendarService.checkAllUsersWithTokens();
  }

  @Get('events')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get Google Calendar events' })
  @ApiResponse({ status: 200, description: 'List of calendar events.' })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized or Google Calendar not connected.',
  })
  async getEvents(
    @Req() req,
    @Query('timeMin') timeMin: string,
    @Query('timeMax') timeMax: string,
    @Query('maxResults') maxResults: number = 100,
    @Query('pageToken') pageToken: string,
    @Query('calendarId') calendarId?: string,
  ) {
    this.logger.log(
      `Getting events for user ${req.user.userId} from ${timeMin} to ${timeMax}`,
    );
    if (calendarId) {
      return this.googleCalendarService.getEvents(
        req.user.userId,
        timeMin,
        timeMax,
        maxResults,
        pageToken,
        calendarId,
      );
    }
    return this.googleCalendarService.getDisplayEvents(
      req.user.userId,
      timeMin,
      timeMax,
      maxResults,
    );
  }

  @Get('events/:eventId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get specific Google Calendar event' })
  @ApiResponse({ status: 200, description: 'Event details.' })
  @ApiResponse({ status: 404, description: 'Event not found.' })
  async getEvent(
    @Req() req,
    @Param('eventId') eventId: string,
    @Query('calendarId') calendarId?: string,
  ) {
    this.logger.log(`Getting event ${eventId} for user ${req.user.userId}`);
    return this.googleCalendarService.getEvent(
      req.user.userId,
      eventId,
      calendarId,
    );
  }

  @Get('calendars')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get user calendars list' })
  @ApiResponse({ status: 200, description: 'List of user calendars.' })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized or Google Calendar not connected.',
  })
  async getCalendars(@Req() req) {
    this.logger.log(`Getting calendars for user ${req.user.userId}`);
    return this.googleCalendarService.getCalendars(req.user.userId);
  }

  @Post('events')
  @UseGuards(JwtAuthGuard)
  async createEvent(@Req() req, @Body() event: any) {
    // event.phaseId may be present on the body
    return this.googleCalendarService.createEvent(req.user.userId, event);
  }

  @Put('events/:eventId')
  @UseGuards(JwtAuthGuard)
  async updateEvent(
    @Req() req,
    @Param('eventId') eventId: string,
    @Body() event: any,
    @Query('calendarId') calendarId?: string,
  ) {
    // event.phaseId may be present on the body
    return this.googleCalendarService.updateEvent(
      req.user.userId,
      eventId,
      event,
      calendarId ? { calendarId } : undefined,
    );
  }

  @Delete('events/:eventId')
  @UseGuards(JwtAuthGuard)
  async deleteEvent(
    @Req() req,
    @Param('eventId') eventId: string,
    @Query('calendarId') calendarId?: string,
  ) {
    return this.googleCalendarService.deleteEvent(
      req.user.userId,
      eventId,
      calendarId,
    );
  }

  @Get('test-config')
  @ApiOperation({ summary: 'Test Google OAuth configuration' })
  @ApiResponse({ status: 200, description: 'Configuration test result.' })
  testConfig() {
    this.logger.log('Testing Google OAuth configuration');

    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI;
    const frontendUrl = getFrontendBaseUrl();

    const config = {
      clientId: clientId ? 'SET' : 'NOT SET',
      clientSecret: clientSecret ? 'SET' : 'NOT SET',
      redirectUri: redirectUri || 'NOT SET',
      frontendUrl: frontendUrl || 'NOT SET',
      authUrl: this.googleCalendarService.getAuthUrl(),
    };

    this.logger.log(
      `Configuration test result: ${JSON.stringify(config, null, 2)}`,
    );

    return {
      message: 'Google OAuth configuration test',
      config,
      timestamp: new Date().toISOString(),
    };
  }
}
