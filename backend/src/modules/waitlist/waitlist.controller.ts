import { Body, Controller, HttpCode, HttpException, HttpStatus, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RateLimiter } from './rate-limit';
import { DetailsInput, JoinInput, WaitlistService } from './waitlist.service';

/** Public (no auth): the landing's early-access form. */
@ApiTags('waitlist')
@Controller('waitlist')
export class WaitlistController {
  /** 10 submissions per IP per 10 minutes, shared by both endpoints. */
  private readonly limiter = new RateLimiter(10, 10 * 60_000);

  constructor(private readonly waitlist: WaitlistService) {}

  @Post()
  @HttpCode(200)
  @ApiOperation({ summary: 'Join the early-access waiting list' })
  join(@Req() req: { ip?: string }, @Body() body: JoinInput) {
    this.guard(req);
    return this.waitlist.join(body ?? {});
  }

  @Post('details')
  @HttpCode(204)
  @ApiOperation({ summary: 'Optional follow-up answers for a waiting-list request' })
  async details(@Req() req: { ip?: string }, @Body() body: DetailsInput) {
    this.guard(req);
    await this.waitlist.details(body ?? {});
  }

  private guard(req: { ip?: string }) {
    if (!this.limiter.take(req.ip || 'unknown')) {
      throw new HttpException('Too many requests. Try again later.', HttpStatus.TOO_MANY_REQUESTS);
    }
  }
}
