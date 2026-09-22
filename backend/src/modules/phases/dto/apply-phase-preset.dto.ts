import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { PHASE_PRESET_IDS, PhasePresetId } from '../lifestyle-presets';

export class ApplyPhasePresetDto {
  @ApiProperty({ enum: PHASE_PRESET_IDS, example: 'working' })
  @IsIn(PHASE_PRESET_IDS)
  presetId: PhasePresetId;

  @ApiProperty({
    required: false,
    example: [1, 2, 3, 4, 5],
    description: 'Days (0=Sun … 6=Sat) for every phase in the preset; omit for all days',
  })
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  weekDays?: number[];
}
