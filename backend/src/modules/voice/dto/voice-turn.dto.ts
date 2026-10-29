import { ApiProperty } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsObject,
  Min,
  IsOptional,
  IsString,
  MinLength,
  ValidateIf,
} from 'class-validator';
import type { VoiceExecutionReport } from '../voice-agent.types';
import { VOICE_COMPANION_MODES, type VoiceCompanionMode } from '../voice-companion-mode';

export class VoiceTurnDto {
  @ApiProperty({
    required: false,
    description: 'Speech-to-text transcript (optional when actionId is set)',
  })
  @ValidateIf((dto: VoiceTurnDto) => !dto.actionId)
  @IsString()
  @MinLength(1)
  transcript?: string;

  @ApiProperty({
    description: 'Client-generated session id for this open voice widget',
  })
  @IsString()
  @MinLength(8)
  sessionId: string;

  @ApiProperty({
    example: 'Europe/Kyiv',
    description: 'IANA timezone from the client (settings preferred on server)',
  })
  @IsString()
  timeZone: string;

  @ApiProperty({
    required: false,
    description: 'Client clock as ISO-8601',
  })
  @IsString()
  @IsOptional()
  clientNowIso?: string;

  @ApiProperty({
    required: false,
    description:
      'Tapped action id (confirm, cancel, build_plan) or `report` after the client ran intents',
  })
  @IsString()
  @IsOptional()
  actionId?: string;

  @ApiProperty({
    required: false,
    description:
      'Sent with actionId `report`: { results: [{ summary, status: applied | skipped | conflict | error }] }',
  })
  @IsOptional()
  @IsObject()
  executionReport?: VoiceExecutionReport;

  @ApiProperty({
    required: false,
    description:
      'Structured voice: executionId of the preview the user is looking at. Required to confirm it.',
  })
  @IsString()
  @IsOptional()
  executionId?: string;

  @ApiProperty({
    required: false,
    description: 'Structured voice: previewRevision of that preview. Sent with executionId.',
  })
  @ValidateIf((dto: VoiceTurnDto) => dto.executionId != null)
  @IsInt()
  @Min(1)
  previewRevision?: number;

  @ApiProperty({
    required: false,
    enum: VOICE_COMPANION_MODES,
    description:
      'assistant keeps the dialogue. fast_create builds a new task from one phrase and asks only when that task cannot be saved.',
  })
  @IsOptional()
  @IsIn(VOICE_COMPANION_MODES)
  mode?: VoiceCompanionMode;
}
