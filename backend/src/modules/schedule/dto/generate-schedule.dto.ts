import { IsNotEmpty, IsDateString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class GenerateScheduleDto {
  @ApiProperty({
    description: 'Schedule generation period start',
    example: '2025-05-01',
  })
  @IsNotEmpty()
  @IsDateString()
  startDate: string;

  @ApiProperty({
    description: 'Schedule generation period end',
    example: '2025-05-31',
  })
  @IsNotEmpty()
  @IsDateString()
  endDate: string;
}
