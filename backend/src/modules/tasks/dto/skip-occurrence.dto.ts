import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsString, MaxLength } from 'class-validator';

export class SkipOccurrenceDto {
  @ApiProperty({
    description: 'Start instant of the slot or recurring instance to skip (ISO 8601).',
    example: '2026-09-21T06:00:00.000Z',
  })
  @IsDateString()
  occurrenceStart: string;

  @ApiProperty({
    required: false,
    description:
      'Google event id of this instance when known. Recurring series masters are never deleted.',
  })
  @IsString()
  @IsOptional()
  @MaxLength(1024)
  googleEventId?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  @MaxLength(255)
  googleEventCalendarId?: string;
}
