import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class TranscribeVoiceDto {
  @ApiProperty({
    description: 'Base64-encoded audio (no data: URL prefix)',
  })
  @IsString()
  audioBase64: string;

  @ApiProperty({
    example: 'audio/webm',
    required: false,
  })
  @IsString()
  @IsOptional()
  mimeType?: string;

  @ApiProperty({
    example: 'uk',
    required: false,
    description:
      'Optional speech language hint (en|uk|ru). Server prefers settings.speechLanguage when set.',
  })
  @IsString()
  @IsOptional()
  language?: string;

  @ApiProperty({
    required: false,
    description:
      'Voice session id so STT and the following turn share one Groq key.',
  })
  @IsString()
  @IsOptional()
  sessionId?: string;
}
