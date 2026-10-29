import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { InternalController } from './internal.controller';
import { InternalTokenGuard } from './internal-token.guard';

@Module({
  imports: [AuthModule, UsersModule],
  controllers: [InternalController],
  providers: [InternalTokenGuard],
})
export class InternalModule {}
