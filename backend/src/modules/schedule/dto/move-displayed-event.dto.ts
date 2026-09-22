import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsNotEmpty, IsOptional, IsString } from 'class-validator';

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
}
