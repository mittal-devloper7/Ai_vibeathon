export type FailureClassificationOutcome = 'success' | 'retryable' | 'terminal';

export type StructuredFailureClass =
  // Success
  | 'success'
  // Retryable
  | 'http_5xx'
  | 'rate_limited'
  | 'timeout'
  | 'too_early'
  | 'connection_reset'
  | 'connection_refused'
  | 'dns_temporary'
  | 'network_error_retryable'
  // Terminal
  | 'http_4xx_terminal'
  | 'redirect_blocked'
  | 'ssrf_blocked'
  | 'dns_permanent'
  | 'tls_validation'
  | 'internal_error';

export interface ClassifiedAttempt {
  outcome: FailureClassificationOutcome;
  failureClass: StructuredFailureClass;
  isRetryable: boolean;
  description: string;
}

export interface ClassifyInput {
  httpStatus: number | null;
  failureClass?: string | null;
  errorMessage?: string | null;
  outcome?: string | null;
}

/**
 * Deterministic pure classifier for HTTP responses and network transport errors.
 */
export function classifyAttempt(input: ClassifyInput): ClassifiedAttempt {
  const { httpStatus, failureClass, errorMessage, outcome } = input;
  const msgLower = (errorMessage || '').toLowerCase();

  // 1. HTTP Status Based Classification
  if (httpStatus !== null && httpStatus !== undefined) {
    // 2xx Success
    if (httpStatus >= 200 && httpStatus < 300) {
      return {
        outcome: 'success',
        failureClass: 'success',
        isRetryable: false,
        description: `HTTP ${httpStatus} Success`,
      };
    }

    // 3xx Redirect Blocked (Webhooks do not follow redirects for security & idempotency)
    if (httpStatus >= 300 && httpStatus < 400) {
      return {
        outcome: 'terminal',
        failureClass: 'redirect_blocked',
        isRetryable: false,
        description: `HTTP ${httpStatus} Redirect Blocked`,
      };
    }

    // 429 Rate Limited
    if (httpStatus === 429) {
      return {
        outcome: 'retryable',
        failureClass: 'rate_limited',
        isRetryable: true,
        description: 'HTTP 429 Too Many Requests (Rate Limited)',
      };
    }

    // 408 Request Timeout
    if (httpStatus === 408) {
      return {
        outcome: 'retryable',
        failureClass: 'timeout',
        isRetryable: true,
        description: 'HTTP 408 Request Timeout',
      };
    }

    // 425 Too Early
    if (httpStatus === 425) {
      return {
        outcome: 'retryable',
        failureClass: 'too_early',
        isRetryable: true,
        description: 'HTTP 425 Too Early',
      };
    }

    // Other 4xx Client Errors (400, 401, 403, 404, 405, 410, 422, etc.)
    if (httpStatus >= 400 && httpStatus < 500) {
      return {
        outcome: 'terminal',
        failureClass: 'http_4xx_terminal',
        isRetryable: false,
        description: `HTTP ${httpStatus} Client Error (Terminal)`,
      };
    }

    // 5xx Server Errors (500, 502, 503, 504, 520, etc.)
    if (httpStatus >= 500 && httpStatus < 600) {
      return {
        outcome: 'retryable',
        failureClass: 'http_5xx',
        isRetryable: true,
        description: `HTTP ${httpStatus} Server Error`,
      };
    }

    // Out-of-spec status codes
    return {
      outcome: 'terminal',
      failureClass: 'internal_error',
      isRetryable: false,
      description: `Unexpected HTTP status ${httpStatus}`,
    };
  }

  // 2. Transport & Network Errors (httpStatus is null)

  // Explicit SSRF rejection
  if (failureClass === 'SSRF_BLOCKED' || msgLower.includes('ssrf') || msgLower.includes('forbidden internal')) {
    return {
      outcome: 'terminal',
      failureClass: 'ssrf_blocked',
      isRetryable: false,
      description: 'Destination URL blocked by SSRF policy',
    };
  }

  // Timeouts (Undici AbortError, connect timeout, headers timeout, body timeout)
  if (
    failureClass === 'TIMEOUT' ||
    outcome === 'timeout' ||
    msgLower.includes('timeout') ||
    msgLower.includes('abort')
  ) {
    return {
      outcome: 'retryable',
      failureClass: 'timeout',
      isRetryable: true,
      description: 'Destination connection or response timed out',
    };
  }

  // Connection Reset (ECONNRESET)
  if (msgLower.includes('econnreset') || msgLower.includes('connection reset')) {
    return {
      outcome: 'retryable',
      failureClass: 'connection_reset',
      isRetryable: true,
      description: 'Connection reset by peer (ECONNRESET)',
    };
  }

  // Connection Refused (ECONNREFUSED)
  if (msgLower.includes('econnrefused') || msgLower.includes('connection refused')) {
    return {
      outcome: 'retryable',
      failureClass: 'connection_refused',
      isRetryable: true,
      description: 'Connection refused by destination host (ECONNREFUSED)',
    };
  }

  // DNS Temporary Error (EAI_AGAIN)
  if (msgLower.includes('eai_again') || msgLower.includes('dns temporary')) {
    return {
      outcome: 'retryable',
      failureClass: 'dns_temporary',
      isRetryable: true,
      description: 'Temporary DNS lookup resolution failure (EAI_AGAIN)',
    };
  }

  // DNS Permanent Error (ENOTFOUND)
  if (msgLower.includes('enotfound') || msgLower.includes('getaddrinfo enotfound')) {
    return {
      outcome: 'terminal',
      failureClass: 'dns_permanent',
      isRetryable: false,
      description: 'Destination host not found in DNS (ENOTFOUND)',
    };
  }

  // TLS / SSL Validation Errors
  if (
    msgLower.includes('cert_') ||
    msgLower.includes('unable_to_verify') ||
    msgLower.includes('self_signed') ||
    msgLower.includes('ssl') ||
    msgLower.includes('tls')
  ) {
    return {
      outcome: 'terminal',
      failureClass: 'tls_validation',
      isRetryable: false,
      description: 'TLS/SSL certificate validation failed',
    };
  }

  // Default fallback for general network/socket failures
  return {
    outcome: 'retryable',
    failureClass: 'network_error_retryable',
    isRetryable: true,
    description: errorMessage || 'Network transport failure',
  };
}
