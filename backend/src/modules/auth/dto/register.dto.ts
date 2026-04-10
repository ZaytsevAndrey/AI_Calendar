import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, MinLength } from 'class-validator';

export class RegisterDto {
  // @IsNotEmpty({ message: 'USERNAME_REQUIRED' })
  username: string;

  @ApiProperty({
    example: 'user@example.com',
    description: 'User email',
  })
  @IsEmail({}, { message: 'INVALID_EMAIL' })
  email: string;

  @ApiProperty({
    example: 'password123',
    description: 'Password (min 6 characters)',
  })
  @IsNotEmpty({ message: 'WEAK_PASSWORD' })
  @MinLength(6, { message: 'WEAK_PASSWORD' })
  password: string;

  @ApiProperty({
    example: 'password123',
    description: 'Password confirmation',
  })
  @IsNotEmpty({ message: 'PASSWORDS_DO_NOT_MATCH' })
  @MinLength(6, { message: 'PASSWORDS_DO_NOT_MATCH' })
  confirmPassword: string;
}
