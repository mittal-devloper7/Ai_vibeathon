import crypto from 'node:crypto';
import { env } from '../config/env.js';

/**
 * Returns hexadecimal SHA-256 hash of input data.
 */
export function sha256Hex(data: string | Buffer): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Returns raw Buffer SHA-256 hash of input data.
 */
export function sha256Buffer(data: string | Buffer): Buffer {
  return crypto.createHash('sha256').update(data).digest();
}

/**
 * Generates a high-entropy 256-bit webhook signing secret and unique key ID.
 */
export function generateSigningSecret(): { secret: string; keyId: string } {
  const secret = `whsec_${crypto.randomBytes(32).toString('base64url')}`;
  const keyId = `key_${crypto.randomBytes(8).toString('hex')}`;
  return { secret, keyId };
}

/**
 * Derives a 32-byte key for AES-256-GCM from the configured HMAC_MASTER_KEY.
 */
function getMasterKey(): Buffer {
  return crypto.createHash('sha256').update(env.HMAC_MASTER_KEY).digest();
}

/**
 * Encrypts a plaintext secret using AES-256-GCM.
 * Output format: v1:<iv_hex>:<auth_tag_hex>:<encrypted_hex>
 */
export function encryptSecret(plaintext: string): string {
  const key = getMasterKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return `v1:${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Decrypts a ciphertext string produced by encryptSecret using AES-256-GCM.
 */
export function decryptSecret(ciphertext: string): string {
  const parts = ciphertext.split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') {
    throw new Error('Unsupported or malformed encrypted secret format');
  }

  const iv = Buffer.from(parts[1]!, 'hex');
  const authTag = Buffer.from(parts[2]!, 'hex');
  const encrypted = Buffer.from(parts[3]!, 'hex');

  const key = getMasterKey();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);

  return decrypted.toString('utf8');
}

/**
 * Produces a canonical JSON string with recursively sorted object keys.
 */
export function canonicalizeJson(obj: unknown): string {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }

  if (Array.isArray(obj)) {
    return `[${obj.map((item) => canonicalizeJson(item)).join(',')}]`;
  }

  const sortedKeys = Object.keys(obj as Record<string, unknown>).sort();
  const pairs = sortedKeys.map((key) => {
    const val = (obj as Record<string, unknown>)[key];
    return `${JSON.stringify(key)}:${canonicalizeJson(val)}`;
  });

  return `{${pairs.join(',')}}`;
}
