import { ApiProperty } from '@nestjs/swagger';
import {
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateHabitDto {
  @ApiProperty({ example: 'Exercise' })
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name: string;

  @ApiProperty({ example: '#22c55e', required: false })
  @IsOptional()
  @IsString()
  @Matches(/^#([A-Fa-f0-9]{6})$/, { message: 'color must be a hex value like #22c55e' })
  color?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiProperty({
    example: '07:30',
    required: false,
    nullable: true,
    description: 'Daily block start (HH:mm). Required together with blockMinutes.',
  })
  @IsOptional()
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, {
    message: 'blockStartTime must be HH:mm',
  })
  blockStartTime?: string | null;

  @ApiProperty({
    example: 30,
    required: false,
    nullable: true,
    description: 'Daily block length in minutes (5–240). Required together with blockStartTime.',
  })
  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(240)
  blockMinutes?: number | null;
}
