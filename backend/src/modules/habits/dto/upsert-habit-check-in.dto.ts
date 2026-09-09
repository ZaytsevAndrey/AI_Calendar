import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';

export class UpsertHabitCheckInDto {
  @ApiProperty({
    example: '2026-09-08',
    description: 'Civil date in the user settings time zone (today or yesterday)',
  })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date must be YYYY-MM-DD' })
  date: string;
}
