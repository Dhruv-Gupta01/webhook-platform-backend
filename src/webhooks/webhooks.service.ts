import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';
import { WebhookSubscription } from './entities/webhook-subscription.entity';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { SubscriptionResponseDto } from './dto/subscription-response.dto';

@Injectable()
export class WebhooksService {
  constructor(
    @InjectRepository(WebhookSubscription)
    private readonly subscriptionsRepo: Repository<WebhookSubscription>,
    private readonly config: ConfigService,
  ) {}

  async subscribe(
    userId: string,
    dto: CreateSubscriptionDto,
  ): Promise<SubscriptionResponseDto> {
    // Generate a cryptographically random secret if user didn't provide one
    // This secret is used to sign outgoing payloads (HMAC-SHA256)
    const secret = dto.secret ?? crypto.randomBytes(32).toString('hex');

    const subscription = this.subscriptionsRepo.create({
      userId,
      name: dto.name,
      sourceUrl: dto.sourceUrl,
      callbackUrl: dto.callbackUrl,
      secret,
      events: dto.events ?? [],
      isActive: true,
    });

    const saved = await this.subscriptionsRepo.save(subscription);
    return this.toResponse(saved);
  }

  async findAll(userId: string): Promise<SubscriptionResponseDto[]> {
    const subs = await this.subscriptionsRepo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
    return subs.map((s) => this.toResponse(s));
  }

  async findOne(userId: string, id: string): Promise<SubscriptionResponseDto> {
    const sub = await this.getOwnedSubscription(userId, id);
    return this.toResponse(sub);
  }

  async cancel(userId: string, id: string): Promise<SubscriptionResponseDto> {
    const sub = await this.getOwnedSubscription(userId, id);

    if (!sub.isActive) {
      throw new ForbiddenException('Subscription is already cancelled');
    }

    sub.isActive = false;
    const updated = await this.subscriptionsRepo.save(sub);
    return this.toResponse(updated);
  }

  async delete(userId: string, id: string): Promise<{ message: string }> {
    const sub = await this.getOwnedSubscription(userId, id);
    await this.subscriptionsRepo.remove(sub);
    return { message: 'Subscription permanently deleted' };
  }

  // --- Internal helpers ---

  // Used by EventsService for the public /incoming/:id endpoint (no userId check needed)
  async findSubscriptionById(id: string): Promise<WebhookSubscription | null> {
    return this.subscriptionsRepo.findOne({ where: { id } });
  }

  // Shared lookup: ensures the subscription exists AND belongs to the requesting user
  async getOwnedSubscription(
    userId: string,
    id: string,
  ): Promise<WebhookSubscription> {
    const sub = await this.subscriptionsRepo.findOne({ where: { id } });
    if (!sub) throw new NotFoundException('Subscription not found');
    if (sub.userId !== userId) throw new ForbiddenException('Access denied');
    return sub;
  }

  // Builds the public-facing webhook endpoint URL that the external service POSTs to
  private buildWebhookEndpoint(id: string): string {
    const appUrl =
      this.config.get<string>('APP_URL') ?? 'http://localhost:3000';
    return `${appUrl}/api/webhooks/incoming/${id}`;
  }

  private toResponse(sub: WebhookSubscription): SubscriptionResponseDto {
    return {
      id: sub.id,
      name: sub.name,
      sourceUrl: sub.sourceUrl,
      callbackUrl: sub.callbackUrl,
      secret: sub.secret,
      events: sub.events ?? [],
      isActive: sub.isActive,
      webhookEndpoint: this.buildWebhookEndpoint(sub.id),
      createdAt: sub.createdAt,
      updatedAt: sub.updatedAt,
    };
  }
}
