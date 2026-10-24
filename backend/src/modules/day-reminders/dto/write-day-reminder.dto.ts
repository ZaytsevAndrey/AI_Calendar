import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { DAY_REMINDER_PATTERNS } from '../day-reminder.dates';

export class WriteDayReminderDto {
  @ApiProperty()
  @IsString()
  @MaxLength(200)
  name: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string | null;

  @ApiProperty({ example: '2026-10-24' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  dueYmd: string;

  @ApiProperty({ required: false, example: '09:00', nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null && value !== '')
  @IsString()
  @Matches(/^([01]?\d|2[0-3]):[0-5]\d$/)
  notificationTime?: string | null;

  @ApiProperty({ required: false, nullable: true, enum: DAY_REMINDER_PATTERNS })
  @IsOptional()
  @ValidateIf((_, value) => value !== null && value !== '')
  @IsIn(DAY_REMINDER_PATTERNS)
  recurrencePattern?: (typeof DAY_REMINDER_PATTERNS)[number] | null;

  @ApiProperty({ required: false, type: [Number] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(7)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  recurrenceWeekDays?: number[] | null;
}
