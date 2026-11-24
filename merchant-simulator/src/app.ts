import crypto from 'node:crypto';
import express, { Request, Response, NextFunction } from 'express';

const app = express();

// Capture raw body for exact HMAC signature verification
app.use(
  express.json({
    verify: (req: Request & { rawBody?: Buffer }, _res, buf) => {
      req.rawBody = buf;
    },
  })
);

export interface WebhookRecord {
  id: string;
  receivedAt: string;
  scenario: string;
  eventId: string | null;
  deliveryId: string | null;
  keyId: string | null;
  timestampHeader: string | null;
  signatureHeader: string | null;
  hmacVerified: boolean | null;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
}

export const state = {
  webhooks: [] as WebhookRecord[],
  eventSeenCounts: new Map<string, number>(),
  hmacSuccessCount: 0,
  hmacFailureCount: 0,
};

function verifySignature(rawBody: Buffer | undefined, signatureHeader: string | undefined, secret: string): boolean {
  if (!rawBody || !signatureHeader || !secret) return false;

  let timestampStr = '';
  let sigHex = '';
  for (const part of signatureHeader.split(',')) {
    const [k, v] = part.split('=');
    if (k === 't' && v) timestampStr = v;
    if (k === 'v1' && v) sigHex = v;
  }

  if (!timestampStr || !sigHex) return false;

  const message = Buffer.concat([Buffer.from(`${timestampStr}.`, 'utf8'), rawBody]);
  const expected = crypto.createHmac('sha256', secret).update(message).digest('hex');

  const expBuf = Buffer.from(expected, 'hex');
  const actBuf = Buffer.from(sigHex, 'hex');
  if (expBuf.length !== actBuf.length) return false;

  return crypto.timingSafeEqual(expBuf, actBuf);
}

// Telemetry recording middleware
app.use((req: Request & { rawBody?: Buffer }, _res: Response, next: NextFunction) => {
  if (req.path.startsWith('/scenario/')) {
    const eventId = (req.headers['x-hookforge-event-id'] as string) || null;
    const deliveryId = (req.headers['x-hookforge-delivery-id'] as string) || null;
    const keyId = (req.headers['x-hookforge-key-id'] as string) || null;
    const timestampHeader = (req.headers['x-hookforge-timestamp'] as string) || null;
    const signatureHeader = (req.headers['x-hookforge-signature'] as string) || null;

    if (eventId) {
      state.eventSeenCounts.set(eventId, (state.eventSeenCounts.get(eventId) || 0) + 1);
    }

    // Optional HMAC verification
    const secret =
      (req.headers['x-test-secret'] as string) ||
      (req.query['secret'] as string) ||
      process.env.SIMULATOR_VERIFY_SECRET;

    let hmacVerified: boolean | null = null;
    if (secret && signatureHeader) {
      hmacVerified = verifySignature(req.rawBody, signatureHeader, secret);
      if (hmacVerified) {
        state.hmacSuccessCount++;
      } else {
        state.hmacFailureCount++;
      }
    }

    state.webhooks.push({
      id: crypto.randomUUID(),
      receivedAt: new Date().toISOString(),
      scenario: req.path.replace('/scenario/', ''),
      eventId,
      deliveryId,
      keyId,
      timestampHeader,
      signatureHeader,
      hmacVerified,
      headers: req.headers,
      body: req.body,
    });
  }
  next();
});

// Scenario 1: Success (200 OK)
app.post('/scenario/success', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'success', received_at: new Date().toISOString() });
});

// Scenario 2: Bad Request (400 Bad Request)
app.post('/scenario/bad-request', (_req: Request, res: Response) => {
  res.status(400).json({ error: 'BAD_REQUEST', message: 'Simulated merchant bad request' });
});

// Scenario 3: Rate Limit (429 with Retry-After header)
app.post('/scenario/rate-limit', (req: Request, res: Response) => {
  const retryAfter = (req.query['retry_after'] as string) || (req.headers['x-retry-after'] as string) || '5';
  res.setHeader('Retry-After', retryAfter);
  res.status(429).json({ error: 'RATE_LIMITED', message: 'Too many requests, try again later' });
});

// Scenario 4: Server Error (503 Service Unavailable)
app.post('/scenario/server-error', (req: Request, res: Response) => {
  const code = Number(req.query.status) || 503;
  res.status(code).json({ error: 'SERVICE_UNAVAILABLE', message: 'Merchant backend temporarily unavailable' });
});

// Scenario 5: Slow / Timeout
app.post('/scenario/slow', async (req: Request, res: Response) => {
  const delayMs = Number(req.query.ms || req.headers['x-delay-ms']) || 12000;
  await new Promise((resolve) => setTimeout(resolve, delayMs));
  res.status(200).json({ status: 'delayed_success', delayed_ms: delayMs });
});

// Scenario 6: Socket Reset
app.post('/scenario/reset', (req: Request, _res: Response) => {
  req.socket.destroy();
});

// Scenario 7: Duplicate Check
app.post('/scenario/duplicate-check', (req: Request, res: Response) => {
  const eventId = req.headers['x-hookforge-event-id'] as string;
  const count = eventId ? state.eventSeenCounts.get(eventId) || 0 : 0;
  res.status(200).json({
    status: 'ok',
    event_id: eventId,
    seen_count: count,
    is_duplicate: count > 1,
  });
});

// Admin: Inspect state
app.get('/admin/state', (_req: Request, res: Response) => {
  res.status(200).json({
    total_received: state.webhooks.length,
    hmac_success: state.hmacSuccessCount,
    hmac_failure: state.hmacFailureCount,
    unique_events_count: state.eventSeenCounts.size,
    recent_webhooks: state.webhooks.slice(-20),
  });
});

// Admin: Reset state
app.post('/admin/reset', (_req: Request, res: Response) => {
  state.webhooks = [];
  state.eventSeenCounts.clear();
  state.hmacSuccessCount = 0;
  state.hmacFailureCount = 0;
  res.status(200).json({ status: 'reset_ok' });
});

export { app };
