import { Agent, request } from 'undici';
import { ssrfGuard } from './ssrfGuard.js';
import { PolicyRejectedError } from '../../shared/errors.js';

export interface DispatchOptions {
  url: string;
  payloadBuffer: Buffer;
  headers: Record<string, string>;
  timeoutMs?: number;
}

export interface AttemptResult {
  outcome: 'success' | 'failure' | 'timeout';
  httpStatus: number | null;
  failureClass: 'HTTP_4XX' | 'HTTP_5XX' | 'TIMEOUT' | 'NETWORK_ERROR' | 'SSRF_BLOCKED' | null;
  latencyMs: number;
  remoteIp: string | null;
  requestBytes: number;
  responseBytes: number;
  responseHeaders: Record<string, string>;
  responseExcerpt: string | null;
  errorMessage: string | null;
}

const MAX_EXCERPT_BYTES = 1024;

export class HttpDispatcher {
  private agent: Agent;

  constructor() {
    this.agent = new Agent({
      connections: 50,
      pipelining: 1,
      connectTimeout: 5000,
      headersTimeout: 10000,
      bodyTimeout: 10000,
    });
  }

  /**
   * Dispatches an HTTP POST request to the destination URL with strict timeout,
   * SSRF validation, body capping, and full diagnostic telemetry.
   */
  public async dispatch(options: DispatchOptions): Promise<AttemptResult> {
    const startTime = Date.now();
    const requestBytes = options.payloadBuffer.length;
    const timeoutMs = options.timeoutMs ?? 10000;

    // 1. SSRF Guard Pre-flight
    try {
      await ssrfGuard.validateUrl(options.url);
    } catch (err) {
      const latencyMs = Date.now() - startTime;
      const errorMsg = err instanceof PolicyRejectedError ? err.message : 'SSRF validation failed';
      return {
        outcome: 'failure',
        httpStatus: null,
        failureClass: 'SSRF_BLOCKED',
        latencyMs,
        remoteIp: null,
        requestBytes,
        responseBytes: 0,
        responseHeaders: {},
        responseExcerpt: null,
        errorMessage: errorMsg,
      };
    }

    // 2. Dispatch via Undici with AbortSignal
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await request(options.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': String(requestBytes),
          'User-Agent': 'HookForge-Delivery/1.0',
          ...options.headers,
        },
        body: options.payloadBuffer,
        signal: controller.signal,
        dispatcher: this.agent,
      });

      const latencyMs = Date.now() - startTime;
      const httpStatus = response.statusCode;

      // Extract response headers as string dictionary
      const responseHeaders: Record<string, string> = {};
      for (const [k, v] of Object.entries(response.headers)) {
        if (v !== undefined) {
          responseHeaders[k] = Array.isArray(v) ? v.join(', ') : String(v);
        }
      }

      // Read response body safely, capping excerpt at MAX_EXCERPT_BYTES
      const chunks: Buffer[] = [];
      let totalBytes = 0;

      for await (const chunk of response.body) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        totalBytes += buf.length;
        if (chunks.reduce((acc, c) => acc + c.length, 0) < MAX_EXCERPT_BYTES) {
          chunks.push(buf);
        }
      }

      const excerptBuffer = Buffer.concat(chunks).subarray(0, MAX_EXCERPT_BYTES);
      const responseExcerpt = excerptBuffer.toString('utf8');

      // Classify outcome
      const isSuccess = httpStatus >= 200 && httpStatus < 300;
      let failureClass: AttemptResult['failureClass'] = null;

      if (!isSuccess) {
        if (httpStatus >= 400 && httpStatus < 500) {
          failureClass = 'HTTP_4XX';
        } else if (httpStatus >= 500) {
          failureClass = 'HTTP_5XX';
        } else {
          failureClass = 'NETWORK_ERROR';
        }
      }

      return {
        outcome: isSuccess ? 'success' : 'failure',
        httpStatus,
        failureClass,
        latencyMs,
        remoteIp: null,
        requestBytes,
        responseBytes: totalBytes,
        responseHeaders,
        responseExcerpt,
        errorMessage: isSuccess ? null : `HTTP status ${httpStatus}`,
      };
    } catch (err: unknown) {
      const latencyMs = Date.now() - startTime;
      const isTimeout =
        (err as { name?: string }).name === 'AbortError' ||
        (err as { code?: string }).code === 'UND_ERR_HEADERS_TIMEOUT' ||
        (err as { code?: string }).code === 'UND_ERR_BODY_TIMEOUT' ||
        (err as { code?: string }).code === 'UND_ERR_CONNECT_TIMEOUT';

      const errorMsg = (err as Error).message || 'HTTP dispatch failed';

      return {
        outcome: isTimeout ? 'timeout' : 'failure',
        httpStatus: null,
        failureClass: isTimeout ? 'TIMEOUT' : 'NETWORK_ERROR',
        latencyMs,
        remoteIp: null,
        requestBytes,
        responseBytes: 0,
        responseHeaders: {},
        responseExcerpt: null,
        errorMessage: errorMsg,
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  public async close(): Promise<void> {
    await this.agent.close();
  }
}

export const httpDispatcher = new HttpDispatcher();
