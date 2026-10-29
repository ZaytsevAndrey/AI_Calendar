import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Logger,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { AccountDeletionService } from './account-deletion.service';
import { DeleteAccountDto } from './dto/delete-account.dto';
import { ApiTags, ApiOperation, ApiResponse, ApiBody } from '@nestjs/swagger';
import { JwtService } from '@nestjs/jwt';
import { GoogleCalendarService } from '../google-calendar/google-calendar.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly authService: AuthService,
    private readonly accountDeletion: AccountDeletionService,
    private readonly jwtService: JwtService,
    private readonly googleCalendarService: GoogleCalendarService,
  ) {}

  private extractUserIdFromRequest(req): string {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      throw new Error('Authorization header missing');
    }
    const token = authHeader.split(' ')[1];
    const payload = this.jwtService.verify(token);
    return payload.sub;
  }

  @Get('google')
  @ApiOperation({ summary: 'Start Google sign-in (login or register)' })
  @ApiResponse({ status: 200, description: 'Authorization URL' })
  getGoogleAuthUrl() {
    return { url: this.googleCalendarService.getLoginAuthUrl() };
  }

  @Post('google/session')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Exchange one-time Google sign-in ticket for JWT' })
  @ApiBody({ schema: { example: { ticket: 'string' } } })
  redeemGoogleSession(@Body('ticket') ticket: string) {
    return this.googleCalendarService.redeemLoginTicket(ticket);
  }

  @ApiOperation({ summary: 'Refresh tokens' })
  @ApiBody({ schema: { example: { refreshToken: 'string' } } })
  @ApiResponse({
    status: 200,
    description: 'Tokens refreshed',
    schema: { example: { access_token: 'string', refresh_token: 'string' } },
  })
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refreshToken(@Body('refresh_token') refreshToken: string) {
    this.logger.log('Refresh token request received');
    const tokens = await this.authService.generateNewTokens(refreshToken);
    this.logger.log('Token refresh successful');
    return tokens;
  }

  @ApiOperation({ summary: 'Logout user' })
  @ApiResponse({ status: 200, description: 'User logged out successfully' })
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@Req() req) {
    const userId = this.extractUserIdFromRequest(req);
    await this.authService.logout(userId);
    return { message: 'User logged out successfully' };
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Current user profile (email for account delete confirm)' })
  @ApiResponse({ status: 200, description: 'Signed-in user email' })
  me(@Req() req) {
    return this.accountDeletion.getProfile(req.user.userId);
  }

  @Delete('account')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Permanently delete the account after typed confirmation; removes app Google events/calendar first',
  })
  @ApiBody({ type: DeleteAccountDto })
  @ApiResponse({ status: 200, description: 'Account deleted' })
  async deleteAccount(@Req() req, @Body() dto: DeleteAccountDto) {
    await this.accountDeletion.deleteAccount(
      req.user.userId,
      dto.confirmation,
    );
    return { ok: true };
  }
}
