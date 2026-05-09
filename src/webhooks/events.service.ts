import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Repository } from 'typeorm';
import { Queue } from 'bullmq';
import * as crypto from 'crypto';
import { WebhookEvent, DeliveryStatus } from './entities/webhook-event.entity';
import { WebhooksService } from './webhooks.service';
import {
  DELIVERY_QUEUE,
  MAX_DELIVERY_ATTEMPTS,
} from './webhooks.constants';
import type { DeliveryJobData } from './delivery.processor';

@Injectable()
export class EventsService {
  private readonly logger = new Logger(EventsService.name);

  constructor(
    @InjectRepository(WebhookEvent)
    private readonly eventsRepo: Repository<WebhookEvent>,

    // Injects the BullMQ Queue instance — we use this to add delivery jobs
    @InjectQueue(DELIVERY_QUEUE)
    private readonly deliveryQueue: Queue<DeliveryJobData>,

    private readonly webhooksService: WebhooksService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  // ─── Incoming Handler ─────────────────────────────────────────────────────

  async handleIncoming(
    subscriptionId: string,
    headers: Record<string, string>,
    rawBody: Buffer,
    payload: Record<string, unknown>,
  ): Promise<{ received: boolean; eventId: string | null }> {
    // 1. Validate subscription
    const sub = await this.webhooksService.findSubscriptionById(subscriptionId);
    if (!sub) throw new NotFoundException('Subscription not found');
    if (!sub.isActive) throw new ForbiddenException('Subscription is not active');

    // 2. Verify HMAC signature (proves request came from the real source)
    this.verifySignature(sub.secret, rawBody, headers);

    // 3. Extract event type from common header patterns
    const eventType =
      headers['x-github-event'] ||
      headers['x-event-type'] ||
      headers['x-hook-event'] ||
      'generic';

    // 4. Apply event type filter — silently drop non-matching events
    if (sub.events?.length > 0 && !sub.events.includes(eventType)) {
      this.logger.debug(`Filtered event type "${eventType}" for sub ${subscriptionId}`);
      return { received: false, eventId: null };
    }

    // 5. Persist event immediately — never lose data even if queue is down
    const event = this.eventsRepo.create({
      subscriptionId,
      headers,
      payload,
      eventType,
      deliveryStatus: DeliveryStatus.PENDING,
      retryCount: 0,
    });
    const saved = await this.eventsRepo.save(event);

    // 6. Push a delivery job to Redis
    // BullMQ will:
    //   - Process it immediately via DeliveryProcessor
    //   - On failure, retry up to MAX_DELIVERY_ATTEMPTS using our backoffStrategy
    //   - Persist the job in Redis so it survives server restarts
    await this.deliveryQueue.add(
      'deliver',
      { eventId: saved.id },
      {
        attempts: MAX_DELIVERY_ATTEMPTS,
        backoff: { type: 'custom' }, // triggers our backoffStrategy in the processor
        removeOnComplete: { count: 100 }, // keep last 100 completed jobs visible in Bull Board
        removeOnFail: false,              // keep all failed jobs in Redis for inspection
      },
    );

    // Notify SSE clients that a new event was received (status: pending)
    this.eventEmitter.emit('webhook.event.updated', {
      subscriptionId,
      eventId: saved.id,
      deliveryStatus: DeliveryStatus.PENDING,
      eventType,
      retryCount: 0,
    });

    this.logger.log(
      `Event ${saved.id} (${eventType}) queued for delivery to ${sub.callbackUrl}`,
    );

    return { received: true, eventId: saved.id };
  }

  // ─── Events Listing (used by the controller) ──────────────────────────────

  async getEventsForSubscription(
    userId: string,
    subscriptionId: string,
    page: number = 1,
    limit: number = 20,
  ) {
    await this.webhooksService.getOwnedSubscription(userId, subscriptionId);

    const [events, total] = await this.eventsRepo.findAndCount({
      where: { subscriptionId },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return {
      data: events,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async getEventById(userId: string, subscriptionId: string, eventId: string) {
    await this.webhooksService.getOwnedSubscription(userId, subscriptionId);
    const event = await this.eventsRepo.findOne({
      where: { id: eventId, subscriptionId },
    });
    if (!event) throw new NotFoundException('Event not found');
    return event;
  }

  // ─── Manual Retry ─────────────────────────────────────────────────────────
  // Lets users re-queue a permanently FAILED event from the dashboard.
  // Creates a fresh BullMQ job — fully independent from the original attempt chain.

  async retryEvent(userId: string, subscriptionId: string, eventId: string) {
    await this.webhooksService.getOwnedSubscription(userId, subscriptionId);

    const event = await this.eventsRepo.findOne({
      where: { id: eventId, subscriptionId },
    });
    if (!event) throw new NotFoundException('Event not found');

    if (event.deliveryStatus !== DeliveryStatus.FAILED) {
      throw new BadRequestException(
        `Only FAILED events can be manually retried. Current status: ${event.deliveryStatus}`,
      );
    }

    // Reset the event state in DB so it looks like a fresh attempt
    await this.eventsRepo.update(eventId, {
      deliveryStatus: DeliveryStatus.PENDING,
      retryCount: 0,
      lastError: null,
      nextRetryAt: null,
      deliveredAt: null,
    });

    // Push a brand new job into the queue
    await this.deliveryQueue.add(
      'deliver',
      { eventId },
      {
        attempts: MAX_DELIVERY_ATTEMPTS,
        backoff: { type: 'custom' },
        removeOnComplete: { count: 100 },
        removeOnFail: false,
      },
    );

    this.logger.log(`Event ${eventId} manually re-queued for delivery`);
    return { queued: true, eventId };
  }

  // ─── Stats ────────────────────────────────────────────────────────────────
  // Returns delivery statistics for a subscription — useful for the dashboard.

  async getStats(userId: string, subscriptionId: string) {
    await this.webhooksService.getOwnedSubscription(userId, subscriptionId);

    const [total, delivered, failed, retrying, pending] = await Promise.all([
      this.eventsRepo.count({ where: { subscriptionId } }),
      this.eventsRepo.count({ where: { subscriptionId, deliveryStatus: DeliveryStatus.DELIVERED } }),
      this.eventsRepo.count({ where: { subscriptionId, deliveryStatus: DeliveryStatus.FAILED } }),
      this.eventsRepo.count({ where: { subscriptionId, deliveryStatus: DeliveryStatus.RETRYING } }),
      this.eventsRepo.count({ where: { subscriptionId, deliveryStatus: DeliveryStatus.PENDING } }),
    ]);

    const successRate = total > 0 ? Math.round((delivered / total) * 100) : 0;

    return { total, delivered, failed, retrying, pending, successRate };
  }

  // ─── HMAC Verification ────────────────────────────────────────────────────

  private verifySignature(
    secret: string,
    rawBody: Buffer,
    headers: Record<string, string>,
  ): void {
    const incoming =
      headers['x-hub-signature-256'] ||
      headers['x-webhook-signature'];

    if (!incoming) return; // no signature = skip (not all sources sign requests)

    const expected = `sha256=${crypto
      .createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex')}`;

    const a = Buffer.from(incoming);
    const b = Buffer.from(expected);

    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      throw new ForbiddenException('Invalid webhook signature');
    }
  }
}
