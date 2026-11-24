import { GoogleGenAI } from '@google/genai';
import { env } from '../../config/env.js';
import { getSharedRedisClient } from '../../database/redis.js';
import { pool } from '../../database/pool.js';
import { DeliveriesRepository } from '../deliveries/deliveries.repository.js';
import { endpointsRepository } from '../endpoints/endpoints.repository.js';
import {
  NotFoundError,
  AiServiceUnavailableError,
  RateLimitExceededError,
} from '../../shared/errors.js';
import { logger } from '../../shared/logger.js';
import {
  IncidentDiagnosis,
  incidentDiagnosisJoiSchema,
  EndpointHealthReport,
  endpointHealthReportJoiSchema,
} from './gemini.schema.js';

const SENSITIVE_KEY_PATTERNS = [
  'secret',
  'password',
  'token',
  'credential',
  'key_hash',
  'encrypted_secret',
  'authorization',
  'cookie',
  'set-cookie',
  'api_key',
  'apikey',
  'access_token',
  'refresh_token',
  'ssn',
  'card',
  'cvv',
  'auth',
];

const SENSITIVE_HEADERS = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'x-hookforge-signature',
  'x-test-secret',
  'proxy-authorization',
  'api-key',
  'x-api-key',
]);

const MAX_STRING_LENGTH = 1024;
const AI_TIMEOUT_MS = 20000;
const RETRY_DELAYS_MS = [1000, 2500];
const TOTAL_ATTEMPTS = 3;
const RATE_LIMIT_MAX_REQUESTS = 20;
const RATE_LIMIT_WINDOW_SEC = 60;
const CACHE_TTL_SEC = 3600;

/**
 * Identifies transient Gemini or network errors (503, UNAVAILABLE, timeouts, high demand) eligible for retry.
 * Explicitly excludes 429 / RESOURCE_EXHAUSTED / quota limit errors to prevent burning daily quota.
 */
function isTransientGeminiError(err: unknown): boolean {
  if (!err) return false;
  if (err instanceof AiServiceUnavailableError) return true;
  const anyErr = err as any;
  const status = anyErr.status ?? anyErr.statusCode ?? anyErr.code;

  // Never retry quota exhaustion errors (HTTP 429 / RESOURCE_EXHAUSTED) to avoid burning daily limits
  if (status === 429 || status === 'RESOURCE_EXHAUSTED') return false;

  const msg = String(anyErr.message || '').toUpperCase();
  if (
    msg.includes('429') ||
    msg.includes('RESOURCE_EXHAUSTED') ||
    msg.includes('QUOTA') ||
    msg.includes('LIMIT EXCEEDED')
  ) {
    return false;
  }

  // Transient 503 / UNAVAILABLE / high demand spikes / timeouts are eligible for retry
  if (status === 503 || status === 'UNAVAILABLE') return true;
  return (
    msg.includes('503') ||
    msg.includes('UNAVAILABLE') ||
    msg.includes('TIMED OUT') ||
    msg.includes('TIMEOUT') ||
    msg.includes('ETIMEDOUT') ||
    msg.includes('ECONNRESET') ||
    msg.includes('OVERLOADED') ||
    msg.includes('HIGH DEMAND')
  );
}

/**
 * Pure deep-sanitization helper for AI telemetry payloads.
 * Strips secrets, redacts credentials/PII, and caps string sizes at 1,024 chars.
 */
export function sanitizeTelemetryForAI(data: unknown): unknown {
  if (data === null || data === undefined) {
    return data;
  }

  if (typeof data === 'string') {
    if (data.length > MAX_STRING_LENGTH) {
      return data.slice(0, MAX_STRING_LENGTH) + '... [TRUNCATED]';
    }
    return data;
  }

  if (typeof data === 'number' || typeof data === 'boolean') {
    return data;
  }

  if (Array.isArray(data)) {
    return data.map((item) => sanitizeTelemetryForAI(item));
  }

  if (typeof data === 'object') {
    const sanitizedObj: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      const lowerKey = key.toLowerCase();

      // Check header or key sensitivity
      const isSensitiveHeader = SENSITIVE_HEADERS.has(lowerKey);
      const isSensitivePattern = SENSITIVE_KEY_PATTERNS.some((p) => lowerKey.includes(p));

      if (isSensitiveHeader || isSensitivePattern) {
        sanitizedObj[key] = '[REDACTED]';
      } else {
        sanitizedObj[key] = sanitizeTelemetryForAI(value);
      }
    }

    return sanitizedObj;
  }

  return String(data);
}

export class GeminiService {
  /**
   * Invokes Google Gemini with timeout guard and resilient 3-attempt retry schedule (1000ms, 2500ms) for transient errors.
   */
  private static async invokeGemini(systemInstruction: string, prompt: string): Promise<string> {
    const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
    const model = env.GEMINI_MODEL || 'gemini-3.5-flash-lite';

    let lastError: unknown = null;

    for (let attempt = 1; attempt <= TOTAL_ATTEMPTS; attempt++) {
      let timerId: NodeJS.Timeout | undefined;
      try {
        const generatePromise = ai.models.generateContent({
          model,
          contents: prompt,
          config: {
            systemInstruction,
            responseMimeType: 'application/json',
          },
        });

        const timeoutPromise = new Promise<never>((_, reject) => {
          timerId = setTimeout(
            () => reject(new AiServiceUnavailableError(`Gemini API request timed out after ${AI_TIMEOUT_MS}ms`)),
            AI_TIMEOUT_MS
          );
        });

        const response = await Promise.race([generatePromise, timeoutPromise]);
        if (timerId) clearTimeout(timerId);

        const textVal = typeof response.text === 'function' ? (response as any).text() : response.text;
        const rawText = textVal || response.candidates?.[0]?.content?.parts?.[0]?.text || '';
        if (rawText && rawText.trim().length > 0) {
          return rawText;
        }
        throw new Error('Gemini API returned an empty response');
      } catch (err: any) {
        if (timerId) clearTimeout(timerId);
        lastError = err;

        const isTransient = isTransientGeminiError(err);
        logger.warn(
          { model, attempt, totalAttempts: TOTAL_ATTEMPTS, isTransient, err: err?.message },
          `Gemini model call failed (attempt ${attempt}/${TOTAL_ATTEMPTS})`
        );

        // Retry ONLY on transient 503 / UNAVAILABLE / timeout / high demand before exhausting retries
        if (isTransient && attempt < TOTAL_ATTEMPTS) {
          const delayMs = RETRY_DELAYS_MS[attempt - 1] ?? 1000;
          logger.info(
            { model, attempt, nextAttempt: attempt + 1, delayMs },
            `Transient Gemini error on attempt ${attempt}/${TOTAL_ATTEMPTS}, retrying after ${delayMs}ms delay...`
          );
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          continue;
        }

        break;
      }
    }

    logger.error({ model, err: lastError }, 'Google Gemini API invocation failed');
    const msg = (lastError as Error)?.message || 'Google Gemini API invocation failed';
    throw new AiServiceUnavailableError(`AI diagnosis failed: ${msg}`);
  }

  /**
   * Enforces per-organization AI request rate limit (max 20 requests per 60s).
   */
  private static async checkRateLimit(orgId: string): Promise<void> {
    try {
      const redis = getSharedRedisClient();
      const currentMinute = Math.floor(Date.now() / (RATE_LIMIT_WINDOW_SEC * 1000));
      const rateKey = `gemini:rate:${orgId}:${currentMinute}`;

      const count = await redis.incr(rateKey);
      if (count === 1) {
        await redis.expire(rateKey, RATE_LIMIT_WINDOW_SEC + 5);
      }

      if (count > RATE_LIMIT_MAX_REQUESTS) {
        throw new RateLimitExceededError(
          `AI request rate limit exceeded (maximum ${RATE_LIMIT_MAX_REQUESTS} requests per minute)`
        );
      }
    } catch (err) {
      if (err instanceof RateLimitExceededError) {
        throw err;
      }
      logger.warn({ err }, 'Redis rate limit check encountered error, failing open for reliability');
    }
  }

  /**
   * Diagnoses a single delivery incident using Google Gemini structured outputs.
   */
  public static async diagnoseDelivery(
    orgId: string,
    deliveryId: string,
    options: { forceRefresh?: boolean } = {}
  ): Promise<IncidentDiagnosis> {
    // 1. Rate limiting check
    await this.checkRateLimit(orgId);

    // 2. Fetch delivery details
    const delivery = await DeliveriesRepository.findById(orgId, deliveryId);
    if (!delivery) {
      throw new NotFoundError('Delivery not found');
    }

    // 3. Check Redis cache
    const redis = getSharedRedisClient();
    const cacheKey = `diag:${deliveryId}:${delivery.attempt_count}`;

    if (!options.forceRefresh) {
      try {
        const cached = await redis.get(cacheKey);
        if (cached) {
          return JSON.parse(cached) as IncidentDiagnosis;
        }
      } catch (err) {
        logger.warn({ err }, 'Redis cache read failed, continuing to live Gemini diagnosis');
      }
    }

    // 4. Verify Gemini API Key configuration
    if (!env.GEMINI_API_KEY || env.GEMINI_API_KEY.trim() === '') {
      throw new AiServiceUnavailableError(
        'Google Gemini API key is not configured. Set GEMINI_API_KEY in environment to enable Incident Copilot.'
      );
    }

    // 5. Fetch circuit breaker context for the delivery endpoint
    const cbRes = await pool.query<{ state: string; failure_count: number; open_until: string | null }>(
      'SELECT state, failure_count, open_until FROM endpoint_circuit_breakers WHERE endpoint_id = $1',
      [delivery.endpoint_id]
    );
    const cbState = cbRes.rows[0] || { state: 'closed', failure_count: 0, open_until: null };

    // 6. Deep sanitize telemetry payload
    const sanitizedTelemetry = sanitizeTelemetryForAI({
      delivery: {
        id: delivery.id,
        event_type: delivery.event_type,
        status: delivery.status,
        attempt_count: delivery.attempt_count,
        max_attempts: delivery.max_attempts,
        last_http_status: delivery.last_http_status,
        last_failure_class: delivery.last_failure_class,
        created_at: delivery.created_at,
        updated_at: delivery.updated_at,
      },
      endpoint: {
        id: delivery.endpoint_id,
        name: delivery.endpoint_name,
        url: delivery.endpoint_url,
      },
      circuit_breaker: cbState,
      attempts: delivery.attempts.map((att) => ({
        attempt_number: att.attempt_number,
        status_code: att.status_code,
        outcome: att.outcome,
        failure_class: att.failure_class,
        latency_ms: att.latency_ms,
        response_excerpt: att.response_excerpt,
        error_message: att.error_message,
        executed_at: att.executed_at,
      })),
      dead_letter: delivery.dead_letter
        ? {
          reason: delivery.dead_letter.reason,
          last_status_code: delivery.dead_letter.last_status_code,
          classified_at: delivery.dead_letter.classified_at,
        }
        : null,
    });

    const systemInstruction = `You are HookForge Incident Copilot, an expert webhook reliability engineer.
Your job is to analyze webhook delivery failure telemetry and provide an authoritative, actionable, structured root-cause diagnosis.
Output ONLY a valid JSON object matching the requested schema with no markdown code blocks, backticks, or preamble:
{
  "incident_title": "Concise summary of the failure",
  "fault_domain": "merchant_endpoint" | "network_or_timeout" | "endpoint_configuration" | "security_policy" | "rate_limiting",
  "severity": "low" | "medium" | "high" | "critical",
  "confidence": "high" | "medium" | "low",
  "root_cause_explanation": "Detailed explanation of why the delivery failed based on status codes, latency, and response excerpts.",
  "ambiguous_delivery_warning": true | false (true if timeout occurred after TCP connection, meaning destination may have processed the request),
  "recommended_operator_actions": ["Action 1", "Action 2"],
  "suggested_policy_adjustment": {
    "attempt_timeout_ms": 10000,
    "max_attempts": 5,
    "max_in_flight": 10,
    "rationale": "Why this policy adjustment is recommended"
  },
  "merchant_issue_summary": "Plain English summary ready to send to the merchant or partner operating the destination endpoint"
}`;

    const prompt = `Analyze this webhook delivery incident telemetry:\n${JSON.stringify(
      sanitizedTelemetry,
      null,
      2
    )}`;

    // 7. Invoke Google Gemini with timeout guard and resilient fallback
    const rawText = await this.invokeGemini(systemInstruction, prompt);

    // 8. Parse and validate JSON response with Joi
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(rawText.replace(/```json\n?|```/g, '').trim());
    } catch {
      logger.error({ rawText }, 'Failed to parse Gemini response as JSON');
      throw new AiServiceUnavailableError('Gemini returned an invalid non-JSON diagnosis response');
    }

    const { error, value: validatedDiagnosis } = incidentDiagnosisJoiSchema.validate(parsedJson);
    if (error) {
      logger.error({ error: error.details, rawText }, 'Gemini diagnosis output failed Joi schema validation');
      throw new AiServiceUnavailableError('Gemini diagnosis response structure is invalid');
    }

    // 9. Cache valid result in Redis (TTL 3600s)
    try {
      await redis.set(cacheKey, JSON.stringify(validatedDiagnosis), 'EX', CACHE_TTL_SEC);
    } catch (cacheErr) {
      logger.warn({ cacheErr }, 'Failed to write Gemini diagnosis to Redis cache');
    }

    return validatedDiagnosis as IncidentDiagnosis;
  }

  /**
   * Generates a health and failure pattern report for an endpoint using Google Gemini.
   */
  public static async generateEndpointHealthReport(
    orgId: string,
    endpointId: string,
    options: { forceRefresh?: boolean } = {}
  ): Promise<EndpointHealthReport> {
    // 1. Rate limiting check
    await this.checkRateLimit(orgId);

    // 2. Fetch endpoint
    const endpoint = await endpointsRepository.findById(orgId, endpointId);
    if (!endpoint) {
      throw new NotFoundError('Endpoint not found');
    }

    // 3. Check Redis cache
    const redis = getSharedRedisClient();
    const tenMinuteBucket = Math.floor(Date.now() / (10 * 60 * 1000));
    const cacheKey = `health:${endpointId}:${tenMinuteBucket}`;

    if (!options.forceRefresh) {
      try {
        const cached = await redis.get(cacheKey);
        if (cached) {
          return JSON.parse(cached) as EndpointHealthReport;
        }
      } catch (err) {
        logger.warn({ err }, 'Redis cache read failed for health report');
      }
    }

    // 4. Verify Gemini API Key configuration
    if (!env.GEMINI_API_KEY || env.GEMINI_API_KEY.trim() === '') {
      throw new AiServiceUnavailableError(
        'Google Gemini API key is not configured. Set GEMINI_API_KEY in environment to enable Health Reports.'
      );
    }

    // 5. Gather endpoint context: circuit breaker & recent deliveries
    const cbRes = await pool.query<{ state: string; failure_count: number; open_until: string | null }>(
      'SELECT state, failure_count, open_until FROM endpoint_circuit_breakers WHERE endpoint_id = $1',
      [endpointId]
    );
    const cbState = cbRes.rows[0] || { state: 'closed', failure_count: 0, open_until: null };

    const deliveriesRes = await pool.query<{
      status: string;
      attempt_count: number;
      last_http_status: number | null;
      last_failure_class: string | null;
      created_at: string;
    }>(
      `SELECT status, attempt_count, last_http_status, last_failure_class, created_at
       FROM deliveries
       WHERE endpoint_id = $1 AND organization_id = $2
       ORDER BY created_at DESC
       LIMIT 30;`,
      [endpointId, orgId]
    );

    // 6. Deep sanitize
    const sanitizedContext = sanitizeTelemetryForAI({
      endpoint: {
        id: endpoint.id,
        name: endpoint.name,
        url: endpoint.url,
        policy: endpoint.policy,
      },
      circuit_breaker: cbState,
      recent_deliveries: deliveriesRes.rows,
    });

    const systemInstruction = `You are HookForge Incident Copilot, an expert webhook infrastructure analyst.
Analyze the recent delivery telemetry and circuit breaker state for this endpoint.
Output ONLY a valid JSON object matching the requested schema with no markdown code blocks, backticks, or preamble:
{
  "overall_health": "healthy" | "degraded" | "critical",
  "summary": "Concise summary of endpoint reliability and health",
  "observed_patterns": ["Pattern 1", "Pattern 2"],
  "recommended_actions": ["Action 1", "Action 2"],
  "suggested_policy": {
    "attempt_timeout_ms": 10000,
    "max_in_flight": 10,
    "max_attempts": 5,
    "rationale": "Explanation of suggested policy modifications"
  }
}`;

    const prompt = `Analyze this webhook endpoint health telemetry:\n${JSON.stringify(
      sanitizedContext,
      null,
      2
    )}`;

    // 7. Invoke Google Gemini with timeout guard and resilient fallback
    const rawText = await this.invokeGemini(systemInstruction, prompt);

    // 8. Parse and validate JSON
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(rawText.replace(/```json\n?|```/g, '').trim());
    } catch {
      logger.error({ rawText }, 'Failed to parse Gemini health report as JSON');
      throw new AiServiceUnavailableError('Gemini returned an invalid non-JSON health report response');
    }

    const { error, value: validatedReport } = endpointHealthReportJoiSchema.validate(parsedJson);
    if (error) {
      logger.error({ error: error.details, rawText }, 'Gemini health report failed Joi schema validation');
      throw new AiServiceUnavailableError('Gemini health report response structure is invalid');
    }

    // 9. Cache in Redis
    try {
      await redis.set(cacheKey, JSON.stringify(validatedReport), 'EX', CACHE_TTL_SEC);
    } catch (cacheErr) {
      logger.warn({ cacheErr }, 'Failed to write Gemini health report to Redis cache');
    }

    return validatedReport as EndpointHealthReport;
  }
}
