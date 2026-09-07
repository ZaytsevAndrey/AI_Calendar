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
}
