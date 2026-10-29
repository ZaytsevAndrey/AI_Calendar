import { ApiProperty } from '@nestjs/swagger';
import {
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  ValidateIf,
} from 'class-validator';

export class MoveDisplayedEventDto {
  @ApiProperty({
    required: false,
    description:
      'App slot to move (voice). The server reads its event id and original interval.',
  })
  @IsOptional()
  @IsUUID()
  slotId?: string;

  @ApiProperty({ description: 'Google event id shown on the calendar, including a recurring instance id' })
  @ValidateIf((dto: MoveDisplayedEventDto) => !dto.slotId)
  @IsString()
  @IsNotEmpty()
  googleEventId: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  calendarId?: string;

  /** Which calendar provider owns this displayed event. Default google. */
  @ApiProperty({ required: false, enum: ['google', 'microsoft', 'apple'] })
  @IsOptional()
  @IsIn(['google', 'microsoft', 'apple'])
  provider?: 'google' | 'microsoft' | 'apple';

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  recurringEventId?: string;

  @ApiProperty({ description: 'Start of the block before the drag' })
  @ValidateIf((dto: MoveDisplayedEventDto) => !dto.slotId)
  @IsDateString()
  originalStart: string;

  @ApiProperty({ description: 'End of the block before the drag' })
  @ValidateIf((dto: MoveDisplayedEventDto) => !dto.slotId)
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
    enum: ['occurrence', 'series', 'all'],
    description:
      'Recurring drag only. occurrence = that day; series = that day and later; all = every open day.',
  })
  @IsOptional()
  @IsIn(['occurrence', 'series', 'all'])
  seriesScope?: 'occurrence' | 'series' | 'all';
}
