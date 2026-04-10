import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsInt, IsOptional, Max, Min } from 'class-validator';

export class SetupDefaultPhasesDto {
  @ApiProperty({
    required: false,
    example: [1, 2, 3, 4, 5],
    description: 'Days (0=Sun … 6=Sat) for default Sleep/Focus; omit for all days',
  })
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  weekDays?: number[];
}
