export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: unknown;
  public readonly isOperational: boolean;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Validation failed', details?: unknown) {
    super(400, 'VALIDATION_ERROR', message, details);
  }
}

export class UnauthenticatedError extends AppError {
  constructor(message = 'Authentication required', details?: unknown) {
    super(401, 'UNAUTHENTICATED', message, details);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Access forbidden', details?: unknown) {
    super(403, 'FORBIDDEN', message, details);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found', details?: unknown) {
    super(404, 'NOT_FOUND', message, details);
  }
}

export class IdempotencyConflictError extends AppError {
  constructor(message = 'Idempotency conflict', details?: unknown) {
    super(409, 'IDEMPOTENCY_CONFLICT', message, details);
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Resource conflict', details?: unknown) {
    super(409, 'CONFLICT', message, details);
  }
}

export class PayloadTooLargeError extends AppError {
  constructor(message = 'Payload too large', details?: unknown) {
    super(413, 'PAYLOAD_TOO_LARGE', message, details);
  }
}

export class PolicyRejectedError extends AppError {
  constructor(message = 'Request rejected by policy', details?: unknown) {
    super(422, 'POLICY_REJECTED', message, details);
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message = 'Service unavailable', details?: unknown) {
    super(503, 'SERVICE_UNAVAILABLE', message, details);
  }
}

export class AiServiceUnavailableError extends AppError {
  constructor(message = 'AI diagnosis service is currently unavailable', details?: unknown) {
    super(503, 'AI_DIAGNOSIS_UNAVAILABLE', message, details);
  }
}

export class RateLimitExceededError extends AppError {
  constructor(message = 'Rate limit exceeded, please retry later', details?: unknown) {
    super(429, 'RATE_LIMIT_EXCEEDED', message, details);
  }
}
