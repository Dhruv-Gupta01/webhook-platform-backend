import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
} from 'typeorm';
import { WebhookSubscription } from './webhook-subscription.entity';

// Tracks where the event is in its delivery lifecycle
export enum DeliveryStatus {
  PENDING = 'pending',       // just received, delivery not yet attempted
  DELIVERED = 'delivered',   // successfully forwarded to callbackUrl
  RETRYING = 'retrying',     // delivery failed, waiting to retry
  FAILED = 'failed',         // all retries exhausted, permanently failed
}

@Entity('webhook_events')
export class WebhookEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // When the subscription is deleted, all its events are deleted too
  @ManyToOne(() => WebhookSubscription, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'subscription_id' })
  subscription: WebhookSubscription;

  @Column({ name: 'subscription_id' })
  subscriptionId: string;

  // Original HTTP headers sent by the external service (e.g., x-github-event)
  @Column({ type: 'jsonb' })
  headers: Record<string, string>;

  // The actual JSON body sent by the external service
  @Column({ type: 'jsonb' })
  payload: Record<string, unknown>;

  // Extracted from headers: "push", "payment.succeeded", etc.
  @Column({ name: 'event_type', length: 100, nullable: true })
  eventType: string;

  @Column({
    name: 'delivery_status',
    type: 'enum',
    enum: DeliveryStatus,
    default: DeliveryStatus.PENDING,
  })
  deliveryStatus: DeliveryStatus;

  // How many delivery attempts have been made (0 = never tried yet)
  @Column({ name: 'retry_count', default: 0 })
  retryCount: number;

  // When the next retry should fire (null if delivered or permanently failed)
  @Column({ name: 'next_retry_at', type: 'timestamptz', nullable: true })
  nextRetryAt: Date | null;

  // Last error message from the delivery attempt (helps users debug their callbackUrl)
  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError: string | null;

  // Populated only when delivery succeeds
  @Column({ name: 'delivered_at', type: 'timestamptz', nullable: true })
  deliveredAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
