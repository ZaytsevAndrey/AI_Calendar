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
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get Google Calendar authorization URL' })
  @ApiResponse({ status: 200, description: 'Return the authorization URL.' })
  getAuthUrl(@Req() req) {
    this.logger.log(
      `Getting Google Calendar auth URL for user ${req.user.userId}`,
    );
    const url = this.googleCalendarService.getAuthUrl(req.user.userId);
    this.logger.log(`Returning auth URL: ${url}`);
    return { url };
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
    @Query('state') state: string,
    @Res() res: Response,
  ) {
    this.logger.log(`Google OAuth callback received`);
    this.logger.log(
      `Code: ${code ? code.substring(0, 10) + '...' : 'NO CODE'}`,
    );
    this.logger.log(`Error: ${error || 'NO ERROR'}`);
    this.logger.log(`State: ${state || 'NO STATE'}`);

    if (error) {
      this.logger.error(`Google OAuth error: ${error}`);
      const redirectUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/settings?googleCalendar=error&error=${error}`;
      this.logger.log(`Redirecting to error page: ${redirectUrl}`);

      // Додаємо всі необхідні заголовки для правильного редіректу
      res.status(302);
      res.header('Location', redirectUrl);
      res.header(
        'Access-Control-Allow-Origin',
        process.env.FRONTEND_URL || 'http://localhost:3000',
      );
      res.header('Access-Control-Allow-Credentials', 'true');
      res.header('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.header('Pragma', 'no-cache');
      res.header('Expires', '0');
      res.redirect(redirectUrl);
      return;
    }

    if (!code) {
      this.logger.error('No authorization code received');
      const redirectUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/settings?googleCalendar=error&error=no_code`;
      this.logger.log(`Redirecting to error page: ${redirectUrl}`);

      // Додаємо всі необхідні заголовки для правильного редіректу
      res.status(302);
      res.header('Location', redirectUrl);
      res.header(
        'Access-Control-Allow-Origin',
        process.env.FRONTEND_URL || 'http://localhost:3000',
      );
      res.header('Access-Control-Allow-Credentials', 'true');
      res.header('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.header('Pragma', 'no-cache');
      res.header('Expires', '0');
      res.redirect(redirectUrl);
      return;
    }

    try {
      this.logger.log('Processing Google OAuth callback');
      // Використовуємо state для отримання userId
      const userId = state;
      this.logger.log(`Using userId from state: ${userId}`);
      await this.googleCalendarService.saveToken(code, userId);
      this.logger.log('Google OAuth callback processed successfully');

      const redirectUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/settings?googleCalendar=success`;
      this.logger.log(`Redirecting to: ${redirectUrl}`);

      // Додаємо всі необхідні заголовки для правильного редіректу
      res.status(302);
      res.header('Location', redirectUrl);
      res.header(
        'Access-Control-Allow-Origin',
        process.env.FRONTEND_URL || 'http://localhost:3000',
      );
      res.header('Access-Control-Allow-Credentials', 'true');
      res.header('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.header('Pragma', 'no-cache');
      res.header('Expires', '0');
      res.redirect(redirectUrl);
    } catch (error) {
      this.logger.error(
        `Error processing Google OAuth callback: ${error.message}`,
      );

      const redirectUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/settings?googleCalendar=error&error=${error.message}`;
      this.logger.log(`Redirecting to error page: ${redirectUrl}`);

      // Додаємо всі необхідні заголовки для правильного редіректу
      res.status(302);
      res.header('Location', redirectUrl);
      res.header(
        'Access-Control-Allow-Origin',
        process.env.FRONTEND_URL || 'http://localhost:3000',
      );
      res.header('Access-Control-Allow-Credentials', 'true');
      res.header('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.header('Pragma', 'no-cache');
      res.header('Expires', '0');
      res.redirect(redirectUrl);
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

  @Delete('disconnect')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Disconnect Google Calendar' })
  @ApiResponse({
    status: 200,
    description: 'Google Calendar disconnected successfully.',
  })
  async disconnectCalendar(@Req() req) {
    this.logger.log(
      `Disconnecting Google Calendar for user ${req.user.userId}`,
    );
    return this.googleCalendarService.disconnectCalendar(req.user.userId);
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
    @Query('calendarId') calendarId: string = 'primary',
  ) {
    this.logger.log(
      `Getting events for user ${req.user.userId} from ${timeMin} to ${timeMax}`,
    );
    return this.googleCalendarService.getEvents(
      req.user.userId,
      timeMin,
      timeMax,
      maxResults,
      pageToken,
      calendarId,
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
    @Query('calendarId') calendarId: string = 'primary',
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
    // event.phaseId може бути у body
    return this.googleCalendarService.createEvent(req.user.userId, event);
  }

  @Put('events/:eventId')
  @UseGuards(JwtAuthGuard)
  async updateEvent(
    @Req() req,
    @Param('eventId') eventId: string,
    @Body() event: any,
  ) {
    // event.phaseId може бути у body
    return this.googleCalendarService.updateEvent(
      req.user.userId,
      eventId,
      event,
    );
  }

  @Delete('events/:eventId')
  @UseGuards(JwtAuthGuard)
  async deleteEvent(@Req() req, @Param('eventId') eventId: string) {
    return this.googleCalendarService.deleteEvent(req.user.userId, eventId);
  }

  @Get('test-config')
  @ApiOperation({ summary: 'Test Google OAuth configuration' })
  @ApiResponse({ status: 200, description: 'Configuration test result.' })
  testConfig() {
    this.logger.log('Testing Google OAuth configuration');

    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI;
    const frontendUrl = process.env.FRONTEND_URL;

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
