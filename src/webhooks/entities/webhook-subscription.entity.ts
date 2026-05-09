import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

@Entity('webhook_subscriptions')
export class WebhookSubscription {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Many subscriptions can belong to one user
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'user_id' })
  userId: string;

  @Column({ length: 100 })
  name: string;

  // The external service's origin URL — used to identify the source
  @Column({ name: 'source_url', length: 500 })
  sourceUrl: string;

  // Where we forward processed events to
  @Column({ name: 'callback_url', length: 500 })
  callbackUrl: string;

  // HMAC secret — used to sign outgoing payloads and verify incoming ones
  // Generated automatically if not provided by the user
  @Column({ length: 255 })
  secret: string;

  // Optional event-type filter: e.g. ["push", "pull_request"]
  // Empty array = accept all event types
  @Column({ type: 'simple-array', nullable: true, default: '' })
  events: string[];

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
