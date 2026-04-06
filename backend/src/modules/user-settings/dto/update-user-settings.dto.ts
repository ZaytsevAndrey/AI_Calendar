import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsInt,
  IsBoolean,
  Min,
  Max,
  Matches,
} from 'class-validator';

export class UpdateUserSettingsDto {
  @ApiProperty({
    example: '08:00',
    description: 'Wake up time in 24h format (HH:MM)',
    required: false,
  })
  @IsString()
  @IsOptional()
  @Matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, {
    message: 'Time must be in format HH:MM',
  })
  wakeTime?: string;

  @ApiProperty({
    example: '23:00',
    description: 'Sleep time in 24h format (HH:MM)',
    required: false,
  })
  @IsString()
  @IsOptional()
  @Matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, {
    message: 'Time must be in format HH:MM',
  })
  sleepTime?: string;

  @ApiProperty({
    example: 25,
    description: 'Default work block duration in minutes',
    required: false,
  })
  @IsInt()
  @IsOptional()
  @Min(1)
  @Max(480) // Max 8 hours
  defaultWorkBlockDuration?: number;

  @ApiProperty({
    example: 5,
    description: 'Default break duration in minutes',
    required: false,
  })
  @IsInt()
  @IsOptional()
  @Min(1)
  @Max(60) // Max 1 hour
  defaultBreakDuration?: number;

  @ApiProperty({
    example: 60,
    description: 'Default lunch duration in minutes',
    required: false,
  })
  @IsInt()
  @IsOptional()
  @Min(1)
  @Max(120) // Max 2 hours
  defaultLunchDuration?: number;

  @ApiProperty({
    example: '12:00',
    description: 'Preferred lunch time in 24h format (HH:MM)',
    required: false,
  })
  @IsString()
  @IsOptional()
  @Matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, {
    message: 'Time must be in format HH:MM',
  })
  preferredLunchTime?: string;

  @ApiProperty({
    example: false,
    description: 'Whether to schedule tasks on weekends',
    required: false,
  })
  @IsBoolean()
  @IsOptional()
  weekendWorkEnabled?: boolean;

  @ApiProperty({
    example: true,
    description: 'Whether Google Calendar is linked',
    required: false,
  })
  @IsBoolean()
  @IsOptional()
  googleCalendarLinked?: boolean;
}
