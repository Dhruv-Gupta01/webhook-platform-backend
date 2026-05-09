// Shapes what the API returns — never leak the raw DB row directly
export class SubscriptionResponseDto {
  id: string;
  name: string;
  sourceUrl: string;
  callbackUrl: string;
  secret: string;   // returned once on creation so user can configure their source
  events: string[];
  isActive: boolean;
  webhookEndpoint: string; // the URL the external service should POST to
  createdAt: Date;
  updatedAt: Date;
}
