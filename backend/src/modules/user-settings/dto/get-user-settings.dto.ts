import { ApiProperty } from '@nestjs/swagger';

export class GetUserSettingsDto {
  @ApiProperty({
    example: '123e4567-e89b-12d3-a456-426614174000',
    description: 'UserSettings ID',
  })
  id: string;

  @ApiProperty({
    example: '123e4567-e89b-12d3-a456-426614174000',
    description: 'User ID',
  })
  userId: string;

  @ApiProperty({
    example: '08:00',
    description: 'Wake up time in 24h format (HH:MM)',
  })
  wakeTime: string;

  @ApiProperty({
    example: '23:00',
    description: 'Sleep time in 24h format (HH:MM)',
  })
  sleepTime: string;

  @ApiProperty({
    example: 25,
    description: 'Default work block duration in minutes',
  })
  defaultWorkBlockDuration: number;

  @ApiProperty({ example: 5, description: 'Default break duration in minutes' })
  defaultBreakDuration: number;

  @ApiProperty({
    example: 60,
    description: 'Default lunch duration in minutes',
  })
  defaultLunchDuration: number;

  @ApiProperty({
    example: '12:00',
    description: 'Preferred lunch time in 24h format (HH:MM)',
  })
  preferredLunchTime: string;

  @ApiProperty({
    example: false,
    description: 'Whether to schedule tasks on weekends',
  })
  weekendWorkEnabled: boolean;

  @ApiProperty({
    example: 30,
    description: 'How many days ahead recurring tasks should be auto-scheduled',
  })
  recurringScheduleHorizonDays: number;

  @ApiProperty({
    example: '2023-07-15T10:00:00Z',
    description: 'Date and time when the settings were created',
  })
  createdAt: Date;

  @ApiProperty({
    example: '2023-07-15T10:00:00Z',
    description: 'Date and time when the settings were last updated',
  })
  updatedAt: Date;
}
