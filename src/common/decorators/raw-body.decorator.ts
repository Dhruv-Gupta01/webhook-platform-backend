import { createParamDecorator, ExecutionContext } from '@nestjs/common';

// Extracts the raw request body Buffer (set by NestFactory rawBody: true)
// Used for HMAC signature verification — we need bytes, not parsed JSON
export const RawBody = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): Buffer => {
    const req = ctx.switchToHttp().getRequest<{ rawBody?: Buffer }>();
    return req.rawBody ?? Buffer.alloc(0);
  },
);
