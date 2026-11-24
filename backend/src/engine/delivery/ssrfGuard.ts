import dns from 'node:dns/promises';
import net from 'node:net';
import { URL } from 'node:url';
import { env } from '../../config/env.js';
import { PolicyRejectedError } from '../../shared/errors.js';

/**
 * Checks whether an IPv4 address is within private, loopback, link-local, or reserved ranges.
 */
function isForbiddenIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) {
    return true;
  }

  const [b0, b1] = parts as [number, number, number, number];

  // Loopback (127.0.0.0/8)
  if (b0 === 127) return true;

  // Zero / Unspecified (0.0.0.0/8)
  if (b0 === 0) return true;

  // RFC 1918 Private: 10.0.0.0/8
  if (b0 === 10) return true;

  // RFC 1918 Private: 172.16.0.0/12 (172.16.0.0 - 172.31.255.255)
  if (b0 === 172 && b1 >= 16 && b1 <= 31) return true;

  // RFC 1918 Private: 192.168.0.0/16
  if (b0 === 192 && b1 === 168) return true;

  // Link-Local / Cloud Metadata (169.254.0.0/16, e.g. AWS/GCP 169.254.169.254)
  if (b0 === 169 && b1 === 254) return true;

  // Broadcast / Multicast / Reserved: 224.0.0.0/4, 240.0.0.0/4, 255.255.255.255
  if (b0 >= 224) return true;

  return false;
}

/**
 * Checks whether an IPv6 address is within private, loopback, link-local, or reserved ranges.
 */
function isForbiddenIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase();

  // Loopback
  if (normalized === '::1') return true;

  // Unspecified
  if (normalized === '::') return true;

  // Unique Local Address (ULA) fc00::/7
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;

  // Link-local unicast fe80::/10
  if (normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb')) {
    return true;
  }

  // Multicast ff00::/8
  if (normalized.startsWith('ff')) return true;

  // IPv4-mapped IPv6 (::ffff:x.x.x.x)
  if (normalized.startsWith('::ffff:')) {
    const ipv4Part = normalized.replace('::ffff:', '');
    if (net.isIPv4(ipv4Part)) {
      return isForbiddenIPv4(ipv4Part);
    }
  }

  return false;
}

export class SsrfGuard {
  private allowedInternalHosts: Set<string>;

  constructor() {
    this.allowedInternalHosts = new Set(
      (env.ALLOWED_INTERNAL_HOSTS || '')
        .split(',')
        .map((h) => h.trim().toLowerCase())
        .filter(Boolean)
    );
  }

  public addAllowedInternalHost(host: string): void {
    this.allowedInternalHosts.add(host.trim().toLowerCase());
  }

  public removeAllowedInternalHost(host: string): void {
    this.allowedInternalHosts.delete(host.trim().toLowerCase());
  }

  /**
   * Validates a destination URL against SSRF policy:
   * - Syntax, credentials, fragments, and allowed schemes
   * - Hostname DNS resolution to ensure no private/loopback/cloud metadata destinations
   */
  public async validateUrl(urlString: string): Promise<void> {
    let parsed: URL;
    try {
      parsed = new URL(urlString);
    } catch {
      throw new PolicyRejectedError('Invalid destination URL syntax');
    }

    // Reject embedded credentials
    if (parsed.username || parsed.password) {
      throw new PolicyRejectedError('Destination URL must not contain embedded user credentials');
    }

    // Reject URL fragments
    if (parsed.hash) {
      throw new PolicyRejectedError('Destination URL must not contain hash fragments');
    }

    const scheme = parsed.protocol.toLowerCase();
    const hostname = parsed.hostname.toLowerCase();
    const isAllowedInternal = this.allowedInternalHosts.has(hostname);

    // Scheme validation
    if (scheme === 'http:') {
      if (!env.ALLOW_INSECURE_HTTP_ENDPOINTS && !isAllowedInternal) {
        throw new PolicyRejectedError('Insecure HTTP endpoints are not permitted. HTTPS is required.');
      }
    } else if (scheme !== 'https:') {
      throw new PolicyRejectedError(`Unsupported URL protocol '${scheme}'. Only HTTPS is permitted.`);
    }

    // Check allowed internal hosts bypass (for local testing environments)
    if (isAllowedInternal) {
      return;
    }

    // Disallow raw localhost hostname
    if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
      throw new PolicyRejectedError('Destination URL resolves to forbidden internal or private IP address');
    }

    // Direct IP address check if hostname is already an IP
    if (net.isIPv4(hostname)) {
      if (isForbiddenIPv4(hostname)) {
        throw new PolicyRejectedError('Destination URL resolves to forbidden internal or private IP address');
      }
      return;
    }

    if (net.isIPv6(hostname)) {
      if (isForbiddenIPv6(hostname)) {
        throw new PolicyRejectedError('Destination URL resolves to forbidden internal or private IP address');
      }
      return;
    }

    // DNS resolution for domain names
    try {
      const records = await dns.lookup(hostname, { all: true });
      if (!records || records.length === 0) {
        throw new PolicyRejectedError('Destination hostname could not be resolved');
      }

      for (const record of records) {
        if (record.family === 4) {
          if (isForbiddenIPv4(record.address)) {
            throw new PolicyRejectedError('Destination URL resolves to forbidden internal or private IP address');
          }
        } else if (record.family === 6) {
          if (isForbiddenIPv6(record.address)) {
            throw new PolicyRejectedError('Destination URL resolves to forbidden internal or private IP address');
          }
        }
      }
    } catch (err: unknown) {
      if (err instanceof PolicyRejectedError) {
        throw err;
      }
      throw new PolicyRejectedError(`Unable to resolve destination hostname '${hostname}'`);
    }
  }
}

export const ssrfGuard = new SsrfGuard();
