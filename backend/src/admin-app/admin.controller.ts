import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AdminAuthService } from './admin-auth.service';
import { AdminGuard, AdminRequest } from './admin.guard';
import { AdminStatsService } from './admin-stats.service';
import { AdminHealthService } from './admin-health.service';
import { AdminActionsService } from './admin-actions.service';

@Controller('admin/auth')
export class AdminAuthController {
  constructor(private readonly auth: AdminAuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Req() req: AdminRequest, @Body('login') login: string, @Body('password') password: string) {
    return this.auth.login(login, password, req.ip || 'unknown');
  }
}

@UseGuards(AdminGuard)
@Controller('admin')
export class AdminController {
  constructor(
    private readonly stats: AdminStatsService,
    private readonly health: AdminHealthService,
    private readonly actions: AdminActionsService,
  ) {}

  @Get('me')
  me(@Req() req: AdminRequest) {
    return req.admin;
  }

  @Get('overview')
  overview() {
    return this.stats.overview();
  }

  @Get('users')
  listUsers(
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('sort') sort?: string,
  ) {
    return this.stats.listUsers({ search, page, pageSize, sort });
  }

  @Get('users/:id')
  user(@Param('id', ParseUUIDPipe) id: string) {
    return this.stats.userDetail(id);
  }

  @Post('users/:id/block')
  @HttpCode(HttpStatus.OK)
  block(@Req() req: AdminRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.actions.setBlocked(req.admin!, id, true);
  }

  @Post('users/:id/unblock')
  @HttpCode(HttpStatus.OK)
  unblock(@Req() req: AdminRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.actions.setBlocked(req.admin!, id, false);
  }

  @Post('users/:id/revoke-sessions')
  @HttpCode(HttpStatus.OK)
  revoke(@Req() req: AdminRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.actions.revokeSessions(req.admin!, id);
  }

  @Post('users/:id/voice-quota/reset')
  @HttpCode(HttpStatus.OK)
  resetQuota(@Req() req: AdminRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.actions.resetVoiceQuota(req.admin!, id);
  }

  @Delete('users/:id')
  @HttpCode(HttpStatus.OK)
  remove(@Req() req: AdminRequest, @Param('id', ParseUUIDPipe) id: string, @Body('confirmation') confirmation: string) {
    return this.actions.deleteUser(req.admin!, id, confirmation);
  }

  @Get('voice/summary')
  voiceSummary(@Query('days') days?: string) {
    return this.stats.voiceSummary(days);
  }

  @Get('voice/turns')
  voiceTurns(
    @Query('userId') userId?: string,
    @Query('failed') failed?: string,
    @Query('before') before?: string,
    @Query('limit') limit?: string,
  ) {
    return this.stats.voiceTurns({ userId, failed, before, limit });
  }

  @Get('voice/turns/:id')
  voiceTurn(@Param('id', ParseUUIDPipe) id: string) {
    return this.stats.voiceTurn(id);
  }

  @Get('health')
  systemHealth() {
    return this.health.health();
  }

  @Get('ops/schedule-jobs')
  scheduleJobs(@Query('status') status?: string, @Query('limit') limit?: string) {
    return this.health.scheduleJobs({ status, limit });
  }

  @Get('ops/google-writes')
  googleWrites(@Query('limit') limit?: string) {
    return this.health.googleWrites(limit);
  }

  @Get('errors')
  errors(@Query('minStatus') minStatus?: string, @Query('limit') limit?: string) {
    return this.health.errors({ minStatus, limit });
  }
}
