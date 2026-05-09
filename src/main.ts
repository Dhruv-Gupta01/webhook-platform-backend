import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { Queue } from 'bullmq';
import { getQueueToken } from '@nestjs/bullmq';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { DELIVERY_QUEUE } from './webhooks/webhooks.constants';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });

  // ── Bull Board ────────────────────────────────────────────────────────────
  // Must be mounted on the raw Express instance BEFORE NestJS middleware
  // (global prefix, guards, pipes) so it lives at /admin/queues not /api/admin/queues
  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath('/admin/queues');

  const deliveryQueue = app.get<Queue>(getQueueToken(DELIVERY_QUEUE));

  createBullBoard({
    queues: [new BullMQAdapter(deliveryQueue)],
    serverAdapter,
  });

  // getHttpAdapter().getInstance() returns the raw Express app — bypasses NestJS middleware stack
  const expressApp = app.getHttpAdapter().getInstance();
  expressApp.use('/admin/queues', serverAdapter.getRouter());

  app.setGlobalPrefix('api');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Global exception filter — uniform error shape across all endpoints
  app.useGlobalFilters(new GlobalExceptionFilter());

  app.enableCors({
    origin: true,
    credentials: true,
  });

  const port = process.env.PORT ?? 3000;
  await app.listen(port, '0.0.0.0');

  console.log(`\n🚀  Server       → http://localhost:${port}/api`);
  console.log(`📊  Bull Board   → http://localhost:${port}/admin/queues`);
  console.log(`🌐  Frontend     → http://localhost:5173\n`);
}

bootstrap();
