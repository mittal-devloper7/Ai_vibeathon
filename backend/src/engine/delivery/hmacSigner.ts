import crypto from 'node:crypto';
import { decryptSecret } from '../../shared/crypto.js';

export interface SignedDeliveryHeaders {
  'X-HookForge-Event-Id': string;
  'X-HookForge-Delivery-Id': string;
  'X-HookForge-Timestamp': string;
  'X-HookForge-Key-Id': string;
  'X-HookForge-Signature': string;
  [key: string]: string;
}

export interface SignPayloadOptions {
  eventId: string;
  deliveryId: string;
  keyId: string;
  encryptedSecret: string;
  payload: unknown;
  timestamp?: number;
}

/**
 * Serializes payload once into UTF-8 Buffer and computes HMAC-SHA256 signature
 * over `<timestamp_seconds>.<raw_utf8_bytes>` using the decrypted endpoint secret.
 */
export function signPayload(options: SignPayloadOptions): {
  headers: SignedDeliveryHeaders;
  payloadBuffer: Buffer;
  timestamp: number;
} {
  const plaintextSecret = decryptSecret(options.encryptedSecret);
  const timestamp = options.timestamp ?? Math.floor(Date.now() / 1000);

  // Exact UTF-8 buffer serialization
  let payloadBuffer: Buffer;
  if (Buffer.isBuffer(options.payload)) {
    payloadBuffer = options.payload;
  } else if (typeof options.payload === 'string') {
    payloadBuffer = Buffer.from(options.payload, 'utf8');
  } else {
    payloadBuffer = Buffer.from(JSON.stringify(options.payload), 'utf8');
  }

  // Message: <timestamp>.<raw_bytes>
  const prefix = Buffer.from(`${timestamp}.`, 'utf8');
  const message = Buffer.concat([prefix, payloadBuffer]);

  const signatureHex = crypto
    .createHmac('sha256', plaintextSecret)
    .update(message)
    .digest('hex');

  const headers: SignedDeliveryHeaders = {
    'X-HookForge-Event-Id': options.eventId,
    'X-HookForge-Delivery-Id': options.deliveryId,
    'X-HookForge-Timestamp': String(timestamp),
    'X-HookForge-Key-Id': options.keyId,
    'X-HookForge-Signature': `t=${timestamp},v1=${signatureHex}`,
  };

  return { headers, payloadBuffer, timestamp };
}

/**
 * Verifies an HMAC-SHA256 webhook signature header (t=<ts>,v1=<sig>)
 * against a raw payload buffer and plaintext secret.
 */
export function verifyHmacSignature(
  rawPayload: string | Buffer,
  signatureHeader: string,
  plaintextSecret: string,
  toleranceSeconds = 300
): boolean {
  try {
    if (!signatureHeader) return false;

    // Parse header: t=<ts>,v1=<sig>
    let timestampStr = '';
    let signatureHex = '';

    for (const part of signatureHeader.split(',')) {
      const [k, v] = part.split('=');
      if (k === 't' && v) timestampStr = v;
      if (k === 'v1' && v) signatureHex = v;
    }

    if (!timestampStr || !signatureHex) return false;

    const timestamp = parseInt(timestampStr, 10);
    if (isNaN(timestamp)) return false;

    // Check tolerance if specified
    if (toleranceSeconds > 0) {
      const now = Math.floor(Date.now() / 1000);
      if (Math.abs(now - timestamp) > toleranceSeconds) {
        return false;
      }
    }

    const payloadBuffer = Buffer.isBuffer(rawPayload)
      ? rawPayload
      : Buffer.from(rawPayload, 'utf8');

    const message = Buffer.concat([
      Buffer.from(`${timestamp}.`, 'utf8'),
      payloadBuffer,
    ]);

    const expectedSignature = crypto
      .createHmac('sha256', plaintextSecret)
      .update(message)
      .digest('hex');

    const expectedBuf = Buffer.from(expectedSignature, 'hex');
    const actualBuf = Buffer.from(signatureHex, 'hex');

    if (expectedBuf.length !== actualBuf.length) {
      return false;
    }

    return crypto.timingSafeEqual(expectedBuf, actualBuf);
  } catch {
    return false;
  }
}
