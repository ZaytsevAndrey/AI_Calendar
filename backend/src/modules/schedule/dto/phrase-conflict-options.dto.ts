import { IsArray, IsIn, IsObject, IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class PhraseConflictOptionsDto {
  @ApiProperty()
  @IsString()
  taskId: string;

  @ApiProperty()
  @IsString()
  taskName: string;

  @ApiProperty({ enum: ['preferred_on_fixed', 'phase_full'] })
  @IsIn(['preferred_on_fixed', 'phase_full'])
  reason: 'preferred_on_fixed' | 'phase_full';

  @ApiProperty({
    type: [String],
    enum: ['move_other', 'move_new', 'skip_occurrence', 'leave_problematic'],
  })
  @IsArray()
  @IsIn(['move_other', 'move_new', 'skip_occurrence', 'leave_problematic'], {
    each: true,
  })
  options: Array<
    'move_other' | 'move_new' | 'skip_occurrence' | 'leave_problematic'
  >;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsObject()
  meta?: Record<string, unknown>;
}
