import { IsString, IsOptional, IsNumber, Min, Max } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class GetEventsDto {
  @ApiProperty({
    description: 'Start time for events (ISO 8601 format)',
    example: '2024-01-01T00:00:00Z',
  })
  @IsString()
  timeMin: string;

  @ApiProperty({
    description: 'End time for events (ISO 8601 format)',
    example: '2024-01-31T23:59:59Z',
  })
  @IsString()
  timeMax: string;

  @ApiProperty({
    description: 'Maximum number of events to return',
    example: 100,
    required: false,
    default: 100,
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(2500)
  maxResults?: number = 100;

  @ApiProperty({
    description: 'Token for pagination',
    required: false,
  })
  @IsOptional()
  @IsString()
  pageToken?: string;

  @ApiProperty({
    description:
      'Calendar ID to fetch events from; omit to use the app-managed calendar when configured, otherwise primary',
    example: 'primary',
    required: false,
  })
  @IsOptional()
  @IsString()
  calendarId?: string;
}
