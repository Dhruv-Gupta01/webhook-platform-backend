import {
  Controller,
  Post,
  Get,
  Param,
  Headers,
  Body,
  UseGuards,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
  Query,
  Sse,
  MessageEvent,
  UnauthorizedException,
} from '@nestjs/common';

import { EventEmitter2 } from '@nestjs/event-emitter';
import { JwtService } from '@nestjs/jwt';
import { Observable, fromEvent, map, filter } from 'rxjs';
import { EventsService } from './events.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RawBody } from '../common/decorators/raw-body.decorator';
import { EventsQueryDto } from './dto/events-query.dto';

@Controller('webhooks')
export class EventsController {
  constructor(
    private readonly events: EventsService,
    private readonly eventEmitter: EventEmitter2,
    private readonly jwtService: JwtService,
  ) {}

  // ─── PUBLIC endpoint ──────────────────────────────────────────────────────

  // POST /api/webhooks/incoming/:id
  @Post('incoming/:id')
  @HttpCode(HttpStatus.ACCEPTED)
  handleIncoming(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers() headers: Record<string, string>,
    @RawBody() rawBody: Buffer,
    @Body() body: Record<string, unknown>,
  ) {
    return this.events.handleIncoming(id, headers, rawBody, body);
  }

  // ─── SSE endpoint ─────────────────────────────────────────────────────────
  // GET /api/webhooks/:subscriptionId/events/stream?token=<jwt>
  //
  // Why token in query param?
  // The browser's EventSource API cannot set custom headers (no Authorization header).
  // Passing JWT as ?token= is the standard workaround for SSE authentication.
  //
  // How it works:
  // 1. Browser opens a persistent GET connection to this URL
  // 2. We validate the JWT from the query param
  // 3. We subscribe to EventEmitter2 for this subscriptionId
  // 4. Every time DeliveryProcessor emits 'webhook.event.updated', we push it down the stream
  // 5. Browser receives it instantly — no polling needed

  @Sse(':subscriptionId/events/stream')
  streamEvents(
    @Param('subscriptionId', ParseUUIDPipe) subscriptionId: string,
    @Query('token') token: string,
  ): Observable<MessageEvent> {
    // Manually validate JWT since @UseGuards doesn't work with @Sse
    if (!token) throw new UnauthorizedException('Token required');
    try {
      this.jwtService.verify(token);
    } catch {
      throw new UnauthorizedException('Invalid token');
    }

    // fromEvent turns EventEmitter2 into an RxJS Observable
    // Every 'webhook.event.updated' emission becomes a stream item
    return fromEvent(
      this.eventEmitter,
      'webhook.event.updated',
    ).pipe(
      // Only forward events belonging to this subscription
      filter((payload: any) => payload.subscriptionId === subscriptionId),
      // Wrap in SSE MessageEvent format
      map(
        (payload): MessageEvent => ({
          data: payload,
        }),
      ),
    );
  }

  // ─── PROTECTED endpoints ──────────────────────────────────────────────────

  @Get(':subscriptionId/events')
  @UseGuards(JwtAuthGuard)
  getEvents(
    @CurrentUser() user: { id: string },
    @Param('subscriptionId', ParseUUIDPipe) subscriptionId: string,
    @Query() query: EventsQueryDto,
  ) {
    return this.events.getEventsForSubscription(
      user.id,
      subscriptionId,
      query.page,
      query.limit,
    );
  }

  @Get(':subscriptionId/events/:eventId')
  @UseGuards(JwtAuthGuard)
  getEvent(
    @CurrentUser() user: { id: string },
    @Param('subscriptionId', ParseUUIDPipe) subscriptionId: string,
    @Param('eventId', ParseUUIDPipe) eventId: string,
  ) {
    return this.events.getEventById(user.id, subscriptionId, eventId);
  }

  // POST /api/webhooks/:subscriptionId/events/:eventId/retry
  // Manually re-queues a permanently FAILED event
  @Post(':subscriptionId/events/:eventId/retry')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  retryEvent(
    @CurrentUser() user: { id: string },
    @Param('subscriptionId', ParseUUIDPipe) subscriptionId: string,
    @Param('eventId', ParseUUIDPipe) eventId: string,
  ) {
    return this.events.retryEvent(user.id, subscriptionId, eventId);
  }

  // GET /api/webhooks/:subscriptionId/stats
  // Returns delivery statistics for a subscription
  @Get(':subscriptionId/stats')
  @UseGuards(JwtAuthGuard)
  getStats(
    @CurrentUser() user: { id: string },
    @Param('subscriptionId', ParseUUIDPipe) subscriptionId: string,
  ) {
    return this.events.getStats(user.id, subscriptionId);
  }
}
