import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, MinLength, ValidateIf } from 'class-validator';

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
    description: 'Tapped action id from the previous turn (confirm, cancel, …)',
  })
  @IsString()
  @IsOptional()
  actionId?: string;
}
