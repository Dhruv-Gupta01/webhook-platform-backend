import {
  IsUrl,
  IsString,
  IsOptional,
  IsArray,
  ArrayMaxSize,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateSubscriptionDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name: string;

  // The origin of the external service that will send events to us
  @IsUrl({ require_tld: false }) // require_tld:false allows localhost in dev
  @MaxLength(500)
  sourceUrl: string;

  // The endpoint on the user's side where we forward processed events
  @IsUrl({ require_tld: false })
  @MaxLength(500)
  callbackUrl: string;

  // Optional: user can provide their own HMAC secret, we generate one if not
  @IsOptional()
  @IsString()
  @MinLength(16)
  @MaxLength(255)
  secret?: string;

  // Optional: filter to only forward specific event types
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(50)
  events?: string[];
}
