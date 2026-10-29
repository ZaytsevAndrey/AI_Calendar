import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { AccountDeletionService } from '../auth/account-deletion.service';
import { UserActivityService } from '../users/user-activity.service';
import { InternalTokenGuard } from './internal-token.guard';
import { integrationStatus } from './integration-status';

const startedAt = new Date().toISOString();

/**
 * Called only by the admin API (header `x-internal-token`). Not in Swagger.
 * Kept to what needs this process: its own runtime facts, its env, its caches,
 * and account delete (which needs the Google cleanup that lives here).
 */
@ApiExcludeController()
@UseGuards(InternalTokenGuard)
@Controller('internal')
export class InternalController {
  constructor(
    private readonly deletion: AccountDeletionService,
    private readonly activity: UserActivityService,
  ) {}

  @Get('status')
  status() {
    const mem = process.memoryUsage();
    return {
      nodeEnv: process.env.NODE_ENV || 'development',
      node: process.version,
      commit: (process.env.RENDER_GIT_COMMIT || '').slice(0, 7) || null,
      startedAt,
      uptimeSec: Math.round(process.uptime()),
      memoryMb: {
        rss: Math.round(mem.rss / 1048576),
        heapUsed: Math.round(mem.heapUsed / 1048576),
        heapTotal: Math.round(mem.heapTotal / 1048576),
      },
      voiceDailyTokenLimit: process.env.VOICE_DAILY_TOKEN_LIMIT ?? null,
      integrations: integrationStatus(),
    };
  }

  /** Drop the cached block/revoke state so an admin change applies on the next request. */
  @Post('users/:id/refresh-access')
  @HttpCode(HttpStatus.OK)
  refreshAccess(@Param('id', ParseUUIDPipe) id: string) {
    this.activity.forget(id);
    return { ok: true };
  }

  /** Same path as self-delete; the confirmation is the account email. */
  @Post('users/:id/delete')
  @HttpCode(HttpStatus.OK)
  async deleteUser(@Param('id', ParseUUIDPipe) id: string, @Body('confirmation') confirmation: string) {
    await this.deletion.deleteAccount(id, String(confirmation || ''));
    this.activity.forget(id);
    return { ok: true };
  }
}
