import {
  Controller,
  Post,
  Get,
  Delete,
  Patch,
  Param,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
} from '@nestjs/common';
import { WebhooksService } from './webhooks.service';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

// Every route in this controller requires a valid JWT
// Except: POST /incoming/:id which is left for Phase 3
@UseGuards(JwtAuthGuard)
@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  // POST /api/webhooks/subscribe
  // Creates a new webhook subscription and returns the endpoint to give to your source
  @Post('subscribe')
  subscribe(
    @CurrentUser() user: { id: string },
    @Body() dto: CreateSubscriptionDto,
  ) {
    return this.webhooks.subscribe(user.id, dto);
  }

  // GET /api/webhooks
  // Returns all subscriptions owned by the authenticated user
  @Get()
  findAll(@CurrentUser() user: { id: string }) {
    return this.webhooks.findAll(user.id);
  }

  // GET /api/webhooks/:id
  // Returns a single subscription (must belong to the user)
  @Get(':id')
  findOne(
    @CurrentUser() user: { id: string },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.webhooks.findOne(user.id, id);
  }

  // PATCH /api/webhooks/:id/cancel
  // Soft-cancels a subscription — keeps history, stops event forwarding
  @Patch(':id/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(
    @CurrentUser() user: { id: string },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.webhooks.cancel(user.id, id);
  }

  // DELETE /api/webhooks/:id
  // Hard-deletes a subscription and all its events (cascades in DB)
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  delete(
    @CurrentUser() user: { id: string },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.webhooks.delete(user.id, id);
  }
}
