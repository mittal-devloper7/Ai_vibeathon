export interface RetryBackoffOptions {
  initialDelayMs?: number;
  maxDelayMs?: number;
  backoffMultiplier?: number;
  maxRetryAfterMs?: number;
  rng?: () => number;
}

export interface CalculateNextAttemptParams {
  attemptCount: number;
  maxAttempts: number;
  createdAt: Date | string;
  maxDeliveryAgeMs?: number;
  retryAfterHeader?: string | null;
  isRetryable: boolean;
  now?: number;
  backoffOptions?: RetryBackoffOptions;
}

export interface NextAttemptResult {
  shouldRetry: boolean;
  terminalReason?: 'NOT_RETRYABLE' | 'MAX_ATTEMPTS_EXCEEDED' | 'MAX_AGE_EXCEEDED';
  nextAttemptAt: Date | null;
  delayMs: number | null;
}

const DEFAULT_INITIAL_DELAY_MS = 1000;
const DEFAULT_MAX_DELAY_MS = 300000; // 5 minutes
const DEFAULT_BACKOFF_MULTIPLIER = 2;
const DEFAULT_MAX_RETRY_AFTER_MS = 86400000; // 24 hours
const DEFAULT_MAX_DELIVERY_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Parses the Retry-After header per RFC 9110 (formerly RFC 7231).
 * Accepts either decimal integer seconds (e.g. "120") or HTTP-date (e.g. "Wed, 21 Oct 2026 07:28:00 GMT").
 * Returns delay in milliseconds, clamped to maxRetryAfterMs.
 */
export function parseRetryAfter(
  headerValue: string | null | undefined,
  now = Date.now(),
  maxRetryAfterMs = DEFAULT_MAX_RETRY_AFTER_MS
): number | null {
  if (!headerValue || typeof headerValue !== 'string') {
    return null;
  }

  const trimmed = headerValue.trim();
  if (!trimmed) {
    return null;
  }

  // 1. Try integer seconds
  if (/^\d+$/.test(trimmed)) {
    const seconds = parseInt(trimmed, 10);
    if (!isNaN(seconds) && seconds >= 0) {
      const delayMs = seconds * 1000;
      return Math.min(delayMs, maxRetryAfterMs);
    }
  }

  // 2. Try HTTP-date format (RFC 9110)
  const parsedDate = Date.parse(trimmed);
  if (!isNaN(parsedDate)) {
    const delayMs = parsedDate - now;
    if (delayMs <= 0) {
      return 0;
    }
    return Math.min(delayMs, maxRetryAfterMs);
  }

  return null;
}

/**
 * Computes exponential backoff with equal jitter:
 *   temp = min(maxDelay, initialDelay * (multiplier ^ (attempt - 1)))
 *   jitteredDelay = (temp / 2) + rng() * (temp / 2)
 */
export function computeBackoffWithEqualJitter(
  attemptNumber: number,
  options: RetryBackoffOptions = {}
): number {
  const initial = options.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS;
  const maxDelay = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const multiplier = options.backoffMultiplier ?? DEFAULT_BACKOFF_MULTIPLIER;
  const rng = options.rng ?? Math.random;

  const attemptIndex = Math.max(0, attemptNumber - 1);
  const exponential = initial * Math.pow(multiplier, attemptIndex);
  const capped = Math.min(exponential, maxDelay);

  const halfDelay = capped / 2;
  const jitter = rng() * halfDelay;
  return Math.round(halfDelay + jitter);
}

/**
 * Pure evaluation function computing whether a delivery should be retried and
 * calculating the exact next_attempt_at timestamp.
 */
export function calculateNextAttempt(params: CalculateNextAttemptParams): NextAttemptResult {
  const {
    attemptCount,
    maxAttempts,
    createdAt,
    maxDeliveryAgeMs = DEFAULT_MAX_DELIVERY_AGE_MS,
    retryAfterHeader,
    isRetryable,
    now = Date.now(),
    backoffOptions = {},
  } = params;

  // 1. Non-retryable failure check
  if (!isRetryable) {
    return {
      shouldRetry: false,
      terminalReason: 'NOT_RETRYABLE',
      nextAttemptAt: null,
      delayMs: null,
    };
  }

  // 2. Max attempts check
  if (attemptCount >= maxAttempts) {
    return {
      shouldRetry: false,
      terminalReason: 'MAX_ATTEMPTS_EXCEEDED',
      nextAttemptAt: null,
      delayMs: null,
    };
  }

  // 3. Max delivery age check
  const createdTimestamp = typeof createdAt === 'string' ? new Date(createdAt).getTime() : createdAt.getTime();
  if (now - createdTimestamp >= maxDeliveryAgeMs) {
    return {
      shouldRetry: false,
      terminalReason: 'MAX_AGE_EXCEEDED',
      nextAttemptAt: null,
      delayMs: null,
    };
  }

  // 4. Compute base exponential delay with equal jitter
  const backoffDelay = computeBackoffWithEqualJitter(attemptCount, backoffOptions);

  // 5. Parse Retry-After header if present
  const maxRetryAfter = backoffOptions.maxRetryAfterMs ?? DEFAULT_MAX_RETRY_AFTER_MS;
  const retryAfterDelay = parseRetryAfter(retryAfterHeader, now, maxRetryAfter);

  // Never schedule earlier than Retry-After, while respecting the backoff minimum
  let finalDelay = backoffDelay;
  if (retryAfterDelay !== null) {
    finalDelay = Math.max(backoffDelay, retryAfterDelay);
  }

  const nextAttemptAt = new Date(now + finalDelay);

  return {
    shouldRetry: true,
    nextAttemptAt,
    delayMs: finalDelay,
  };
}
