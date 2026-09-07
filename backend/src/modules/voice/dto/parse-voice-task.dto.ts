import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, MinLength } from 'class-validator';

export class ParseVoiceTaskDto {
  @ApiProperty({ description: 'Speech-to-text transcript' })
  @IsString()
  @MinLength(1)
  transcript: string;

  @ApiProperty({
    example: 'Europe/Kyiv',
    description: 'IANA timezone from the client',
  })
  @IsString()
  timeZone: string;

  @ApiProperty({
    required: false,
    description: 'Client clock as ISO-8601 (UTC or offset)',
  })
  @IsString()
  @IsOptional()
  clientNowIso?: string;

  @ApiProperty({
    required: false,
    description: 'Original utterance when this is a clarification reply',
  })
  @IsString()
  @IsOptional()
  previousTranscript?: string;

  @ApiProperty({
    required: false,
    description: 'User reply to the clarifying question',
  })
  @IsString()
  @IsOptional()
  clarificationAnswer?: string;
}
