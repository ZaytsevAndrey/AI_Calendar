import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class SpeakVoiceDto {
  @ApiProperty({ description: 'Reply text to synthesize' })
  @IsString()
  text: string;

  @ApiProperty({ example: 'uk', required: false })
  @IsString()
  @IsOptional()
  language?: string;
}
