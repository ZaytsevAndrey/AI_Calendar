import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './user.entity';
import { UserActivityService } from './user-activity.service';

@Module({
  imports: [TypeOrmModule.forFeature([User])],
  providers: [UserActivityService],
  exports: [TypeOrmModule, UserActivityService],
})
export class UsersModule {}
