// Queue name — used both when adding jobs and in the processor
export const DELIVERY_QUEUE = 'webhook-delivery';

// Exact delay in ms before each retry attempt (exponential-ish backoff)
// Index 0 = delay before attempt 2, index 1 = delay before attempt 3, etc.
export const RETRY_DELAYS_MS = [
  60_000,       // 1 minute
  300_000,      // 5 minutes
  1_800_000,    // 30 minutes
  7_200_000,    // 2 hours
  86_400_000,   // 24 hours
];

export const MAX_DELIVERY_ATTEMPTS = RETRY_DELAYS_MS.length + 1; // 6 total (1 initial + 5 retries)
