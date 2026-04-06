import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional, IsArray, IsEnum } from 'class-validator';

export class CreatePhaseDto {
  @ApiProperty()
  @IsString()
  name: string;

  @ApiProperty()
  @IsString()
  color: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty()
  @IsString()
  startTime: string;

  @ApiProperty()
  @IsString()
  endTime: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsArray()
  weekDays?: number[];

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  parentPhaseId?: string;

  @ApiProperty({ default: 'time_phase', enum: ['time_phase', 'sleep_time'] })
  @IsEnum(['time_phase', 'sleep_time'])
  type?: string;
} 