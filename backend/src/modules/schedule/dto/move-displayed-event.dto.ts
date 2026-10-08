import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class MoveDisplayedEventDto {
  @ApiProperty({ description: 'Google event id shown on the calendar, including a recurring instance id' })
  @IsString()
  @IsNotEmpty()
  googleEventId: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  calendarId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  recurringEventId?: string;

  @ApiProperty({ description: 'Start of the block before the drag' })
  @IsDateString()
  originalStart: string;

  @ApiProperty({ description: 'End of the block before the drag' })
  @IsDateString()
  originalEnd: string;

  @ApiProperty()
  @IsDateString()
  start: string;

  @ApiProperty()
  @IsDateString()
  end: string;

  @ApiProperty({
    required: false,
    enum: ['occurrence', 'series'],
    description:
      'Recurring drag only. occurrence detaches that day. series moves that day and every later day.',
  })
  @IsOptional()
  @IsIn(['occurrence', 'series'])
  seriesScope?: 'occurrence' | 'series';
}
