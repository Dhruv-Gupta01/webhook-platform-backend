import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { AuthModule } from '../auth/auth.module';
import { WebhookSubscription } from './entities/webhook-subscription.entity';
import { WebhookEvent } from './entities/webhook-event.entity';
import { WebhooksService } from './webhooks.service';
import { WebhooksController } from './webhooks.controller';
import { EventsService } from './events.service';
import { EventsController } from './events.controller';
import { DeliveryProcessor } from './delivery.processor';
import { DELIVERY_QUEUE } from './webhooks.constants';

@Module({
  imports: [
    TypeOrmModule.forFeature([WebhookSubscription, WebhookEvent]),

    // Register the queue — this creates the Redis-backed queue
    // The global BullMQ connection (in AppModule) is used automatically
    BullModule.registerQueue({ name: DELIVERY_QUEUE }),
    AuthModule,
  ],
  controllers: [WebhooksController, EventsController],
  providers: [
    WebhooksService,
    EventsService,
    DeliveryProcessor, // the worker that processes delivery jobs
  ],
  exports: [WebhooksService, EventsService],
})
export class WebhooksModule {}
