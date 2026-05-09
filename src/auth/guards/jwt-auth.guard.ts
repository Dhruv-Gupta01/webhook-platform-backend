import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

// Applying @UseGuards(JwtAuthGuard) to any route enforces Bearer token auth
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
