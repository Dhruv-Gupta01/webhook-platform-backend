import { IsEmail, IsString, MinLength, MaxLength, IsOptional } from 'class-validator';

export class RegisterDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  @MaxLength(72) // bcrypt truncates at 72 bytes
  password: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;
}
