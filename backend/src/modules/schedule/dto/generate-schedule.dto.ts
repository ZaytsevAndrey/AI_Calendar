import { IsNotEmpty, IsDateString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class GenerateScheduleDto {
  @ApiProperty({
    description: 'Дата початку періоду для генерації розкладу',
    example: '2025-05-01',
  })
  @IsNotEmpty()
  @IsDateString()
  startDate: string;

  @ApiProperty({
    description: 'Дата закінчення періоду для генерації розкладу',
    example: '2025-05-31',
  })
  @IsNotEmpty()
  @IsDateString()
  endDate: string;
}
