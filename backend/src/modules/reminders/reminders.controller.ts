import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RemindersService } from './reminders.service';

@ApiTags('reminders')
@Controller('reminders')
export class ReminderTickController {
  constructor(private readonly reminders: RemindersService) {}

  @Post('tick')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Send reminders that are due now. Header x-reminder-cron-secret.',
  })
  tick(@Headers('x-reminder-cron-secret') secret?: string | string[]) {
    const value = Array.isArray(secret) ? secret[0] : secret;
    return this.reminders.tickFromCron(value);
  }
}

@ApiTags('reminders')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('reminders')
export class RemindersController {
  constructor(private readonly reminders: RemindersService) {}

  @Get('vapid-public-key')
  @ApiOperation({ summary: 'Public VAPID key for browser push subscriptions' })
  vapidPublicKey() {
    return this.reminders.getVapidPublicKey();
  }

  @Post('subscriptions')
  @ApiOperation({ summary: 'Store this browser push subscription' })
  saveSubscription(
    @Request() req,
    @Body() body: { endpoint?: string; p256dh?: string; auth?: string },
  ) {
    return this.reminders.saveSubscription(req.user.userId, body ?? {});
  }

  @Delete('subscriptions')
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove this browser push subscription' })
  async removeSubscription(@Request() req, @Body() body: { endpoint?: string }) {
    await this.reminders.removeSubscription(req.user.userId, body?.endpoint);
  }
}
