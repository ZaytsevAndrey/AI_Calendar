import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, MinLength } from 'class-validator';

export class RegisterDto {
  // @IsNotEmpty({ message: 'USERNAME_REQUIRED' })
  username: string;

  @ApiProperty({
    example: 'user@example.com',
    description: 'Email користувача',
  })
  @IsEmail({}, { message: 'INVALID_EMAIL' })
  email: string;

  @ApiProperty({
    example: 'password123',
    description: 'Пароль користувача (мінімум 6 символів)',
  })
  @IsNotEmpty({ message: 'WEAK_PASSWORD' })
  @MinLength(6, { message: 'WEAK_PASSWORD' })
  password: string;

  @ApiProperty({
    example: 'password123',
    description: 'Підтвердження паролю',
  })
  @IsNotEmpty({ message: 'PASSWORDS_DO_NOT_MATCH' })
  @MinLength(6, { message: 'PASSWORDS_DO_NOT_MATCH' })
  confirmPassword: string;
}
