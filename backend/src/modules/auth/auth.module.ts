import { Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { MultiProviderAuthController } from './multi-provider-auth.controller';
import { JwtStrategy } from './jwt.strategy';
import { UserIdentity } from './entities/user-identity.entity';
import { UserIdentitiesService } from './user-identities.service';
import { MicrosoftAuthService } from './microsoft-auth.service';
import { UsersModule } from '../users/users.module';
import { User } from '../users/user.entity';
import { UserSettings } from '../user-settings/entities/user-settings.entity';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { GoogleCalendarModule } from '../google-calendar/google-calendar.module';
import { CalendarProvidersModule } from '../calendar-providers/calendar-providers.module';

@Module({
  imports: [
    ConfigModule,
    UsersModule,
    PassportModule,
    GoogleCalendarModule,
    forwardRef(() => CalendarProvidersModule),
    TypeOrmModule.forFeature([UserIdentity, UserSettings, User]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET'),
        signOptions: { expiresIn: configService.get<string>('JWT_EXPIRES_IN') },
      }),
    }),
  ],
  controllers: [AuthController, MultiProviderAuthController],
  providers: [
    AuthService,
    JwtStrategy,
    UserIdentitiesService,
    MicrosoftAuthService,
  ],
  exports: [AuthService, UserIdentitiesService, MicrosoftAuthService],
})
export class AuthModule {}
