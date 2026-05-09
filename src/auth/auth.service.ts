import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { UsersService } from '../users/users.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { JwtPayload } from './strategies/jwt.strategy';

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly jwt: JwtService,
  ) {}

  async register(dto: RegisterDto) {
    const user = await this.users.create(dto.email, dto.password, dto.name);
    const token = this.signToken(user.id, user.email);
    return { accessToken: token, user: this.sanitize(user) };
  }

  async login(dto: LoginDto) {
    const user = await this.users.findByEmail(dto.email);
    if (!user) throw new UnauthorizedException('Invalid credentials');

    const matches = await bcrypt.compare(dto.password, user.password);
    if (!matches) throw new UnauthorizedException('Invalid credentials');

    const token = this.signToken(user.id, user.email);
    return { accessToken: token, user: this.sanitize(user) };
  }

  private signToken(userId: string, email: string): string {
    const payload: JwtPayload = { sub: userId, email };
    return this.jwt.sign(payload);
  }

  // Never return the password hash to the client
  private sanitize(user: { id: string; email: string; name: string }) {
    return { id: user.id, email: user.email, name: user.name };
  }
}
