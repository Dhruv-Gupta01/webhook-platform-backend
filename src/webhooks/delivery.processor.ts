import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as crypto from 'crypto';
import axios from 'axios';
import { WebhookEvent, DeliveryStatus } from './entities/webhook-event.entity';
import { WebhookSubscription } from './entities/webhook-subscription.entity';
import {
  DELIVERY_QUEUE,
  RETRY_DELAYS_MS,
  MAX_DELIVERY_ATTEMPTS,
} from './webhooks.constants';

// Shape of data stored in each Redis job
export interface DeliveryJobData {
  eventId: string;
}

// Register this class as the processor for the DELIVERY_QUEUE
// The backoffStrategy tells BullMQ exactly how long to wait before each retry
@Processor(DELIVERY_QUEUE, {
  settings: {
    // attemptsMade = how many attempts have already failed when computing next delay
    // e.g. attemptsMade=1 means first attempt failed → wait RETRY_DELAYS_MS[0] = 1 min
    backoffStrategy: (attemptsMade: number) =>
      RETRY_DELAYS_MS[attemptsMade - 1] ??
      RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1],
  },
})
export class DeliveryProcessor extends WorkerHost {
  private readonly logger = new Logger(DeliveryProcessor.name);

  constructor(
    @InjectRepository(WebhookEvent)
    private readonly eventsRepo: Repository<WebhookEvent>,
    @InjectRepository(WebhookSubscription)
    private readonly subscriptionsRepo: Repository<WebhookSubscription>,
    private readonly eventEmitter: EventEmitter2,
  ) {
    super();
  }

  // ─── Main job handler ─────────────────────────────────────────────────────
  // BullMQ calls this for every job. If we throw, BullMQ retries the job
  // automatically using our backoffStrategy above.

  async process(job: Job<DeliveryJobData>): Promise<void> {
    const { eventId } = job.data;

    // Fetch fresh event + subscription from DB on every attempt
    // (subscription might have been cancelled between retries)
    const event = await this.eventsRepo.findOne({ where: { id: eventId } });
    if (!event) {
      this.logger.warn(`Job ${job.id}: event ${eventId} not found, skipping`);
      return; // don't throw — no point retrying a deleted event
    }

    const sub = await this.subscriptionsRepo.findOne({
      where: { id: event.subscriptionId },
    });

    // If subscription was cancelled while this job was queued, abort silently
    if (!sub || !sub.isActive) {
      this.logger.warn(
        `Job ${job.id}: subscription cancelled, discarding event ${eventId}`,
      );
      await this.eventsRepo.update(eventId, {
        deliveryStatus: DeliveryStatus.FAILED,
        lastError: 'Subscription was cancelled',
      });
      return;
    }

    this.logger.log(
      `Job ${job.id}: delivering event ${eventId} ` +
        `(attempt ${job.attemptsMade + 1}/${MAX_DELIVERY_ATTEMPTS}) ` +
        `→ ${sub.callbackUrl}`,
    );

    // Sign outgoing payload — receiver can verify it came from our platform
    const signature = this.buildSignature(sub.secret, event.payload);

    try {
      await axios.post(sub.callbackUrl, event.payload, {
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Signature': signature,
          'X-Event-Type': event.eventType,
          'X-Subscription-Id': sub.id,
          'X-Event-Id': event.id,
          'X-Attempt': String(job.attemptsMade + 1),
        },
        timeout: 10_000,
      });

      // ✅ Success — update DB and notify SSE subscribers
      await this.eventsRepo.update(eventId, {
        deliveryStatus: DeliveryStatus.DELIVERED,
        deliveredAt: new Date(),
        retryCount: job.attemptsMade + 1,
        lastError: null,
      });

      // Broadcast to any open SSE connections for this subscription
      this.eventEmitter.emit('webhook.event.updated', {
        subscriptionId: event.subscriptionId,
        eventId,
        deliveryStatus: DeliveryStatus.DELIVERED,
        eventType: event.eventType,
        retryCount: job.attemptsMade + 1,
      });

      this.logger.log(`✅ Event ${eventId} delivered on attempt ${job.attemptsMade + 1}`);
    } catch (err: unknown) {
      const errorMessage = this.extractError(err);

      // Update retry count so the dashboard shows live progress
      const isLastAttempt = job.attemptsMade + 1 >= MAX_DELIVERY_ATTEMPTS;
      await this.eventsRepo.update(eventId, {
        retryCount: job.attemptsMade + 1,
        lastError: errorMessage,
        // Status will be set to FAILED by onFailed if last attempt,
        // otherwise BullMQ will call process() again after the backoff delay
        deliveryStatus: isLastAttempt
          ? DeliveryStatus.FAILED
          : DeliveryStatus.RETRYING,
      });

      // Broadcast failure update to SSE connections
      this.eventEmitter.emit('webhook.event.updated', {
        subscriptionId: event.subscriptionId,
        eventId,
        deliveryStatus: isLastAttempt ? DeliveryStatus.FAILED : DeliveryStatus.RETRYING,
        eventType: event.eventType,
        retryCount: job.attemptsMade + 1,
        lastError: errorMessage,
      });

      this.logger.warn(
        `⏳ Event ${eventId} attempt ${job.attemptsMade + 1} failed: ${errorMessage}`,
      );

      // IMPORTANT: must re-throw so BullMQ knows this attempt failed
      // and schedules the next retry via our backoffStrategy
      throw new Error(errorMessage);
    }
  }

  // ─── Worker lifecycle events ───────────────────────────────────────────────

  @OnWorkerEvent('completed')
  onCompleted(job: Job<DeliveryJobData>) {
    this.logger.log(`Job ${job.id} completed for event ${job.data.eventId}`);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<DeliveryJobData> | undefined, error: Error) {
    if (!job) return;
    this.logger.error(
      `Job ${job.id} failed for event ${job.data.eventId}: ${error.message}`,
    );
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private buildSignature(secret: string, payload: unknown): string {
    const body = JSON.stringify(payload);
    return `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`;
  }

  private extractError(err: unknown): string {
    if (axios.isAxiosError(err) && err.response) {
      return `HTTP ${err.response.status}: ${JSON.stringify(err.response.data).slice(0, 200)}`;
    }
    return err instanceof Error ? err.message : 'Unknown error';
  }
}
