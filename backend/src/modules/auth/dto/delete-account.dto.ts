import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class DeleteAccountDto {
  @ApiProperty({
    description:
      'Must equal the account email (case-insensitive) or the exact word DELETE',
    example: 'DELETE',
  })
  @IsString()
  @MinLength(1)
  confirmation: string;
}
