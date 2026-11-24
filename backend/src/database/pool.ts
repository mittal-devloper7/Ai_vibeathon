import { Pool, PoolClient, PoolConfig } from 'pg';
import { env } from '../config/env.js';
import { logger } from '../shared/logger.js';

export interface BuildPoolConfigOptions {
  databaseUrl: string;
  max?: number;
  connectionTimeoutMillis?: number;
  idleTimeoutMillis?: number;
  sslRejectUnauthorized?: boolean;
}

const TRANSIENT_ERROR_CODES = new Set([
  'ETIMEDOUT',
  'ECONNRESET',
  'ECONNREFUSED',
  'EPIPE',
  'ENOTFOUND',
  'EAI_AGAIN',
  '57P01', // admin_shutdown
  '57P02', // crash_shutdown
  '57P03', // cannot_connect_now (e.g. Postgres starting up / Neon waking)
  '08000', // connection_exception
  '08001', // sqlclient_unable_to_establish_sqlconnection
  '08003', // connection_does_not_exist
  '08006', // connection_failure
]);

const TRANSIENT_ERROR_SUBSTRINGS = [
  'connection terminated unexpectedly',
  'connection terminated due to connection timeout',
  'timeout exceeded when trying to connect',
  'connection timeout',
  'the database system is starting up',
  'could not connect to compute node',
  "couldn't connect to compute node",
  'client has encountered a connection error',
  'socket hang up',
];

/**
 * Checks whether an error represents a transient PostgreSQL connection or
 * cold-start failure (such as Neon scale-to-zero wake-up timeouts or drops).
 */
export function isTransientConnectionError(err: unknown): boolean {
  if (!err || typeof err !== 'object') {
    return false;
  }

  const candidate = err as { code?: unknown; message?: unknown; cause?: unknown };
  if (typeof candidate.code === 'string' && TRANSIENT_ERROR_CODES.has(candidate.code.toUpperCase())) {
    return true;
  }

  if (typeof candidate.message === 'string') {
    const lower = candidate.message.toLowerCase();
    if (TRANSIENT_ERROR_SUBSTRINGS.some((sub) => lower.includes(sub))) {
      return true;
    }
  }

  if (candidate.cause && candidate.cause !== err) {
    return isTransientConnectionError(candidate.cause);
  }

  return false;
}

/**
 * Builds a pg PoolConfig that handles both local non-SSL Docker PostgreSQL
 * and cloud/serverless endpoints (such as Neon PostgreSQL with cold starts,
 * `sslmode=require`/`verify-full`, and `channel_binding=require`).
 */
export function buildPgPoolConfig(options: BuildPoolConfigOptions): PoolConfig {
  const parsedUrl = new URL(options.databaseUrl);
  const params = parsedUrl.searchParams;

  const sslMode = params.get('sslmode')?.toLowerCase();
  const sslParam = params.get('ssl')?.toLowerCase();
  const useLibpqCompat = params.get('uselibpqcompat')?.toLowerCase() === 'true';
  const channelBinding = params.get('channel_binding')?.toLowerCase();
  const sslNegotiation = params.get('sslnegotiation')?.toLowerCase();
  const hasCertFiles = Boolean(params.get('sslrootcert') || params.get('sslcert') || params.get('sslkey'));
  const isNeonHost = parsedUrl.hostname.toLowerCase().endsWith('.neon.tech');

  const config: PoolConfig = {
    connectionString: options.databaseUrl,
    max: options.max ?? 20,
    idleTimeoutMillis: options.idleTimeoutMillis ?? 20000,
    connectionTimeoutMillis: options.connectionTimeoutMillis ?? 30000,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10000,
  };

  if (sslNegotiation === 'direct' || sslNegotiation === 'postgres') {
    config.sslnegotiation = sslNegotiation;
  }

  const sslExplicitlyDisabled =
    sslMode === 'disable' || sslParam === 'false' || sslParam === '0';

  if (sslExplicitlyDisabled) {
    config.ssl = false;
    return config;
  }

  const shouldUseSsl =
    Boolean(sslMode) ||
    Boolean(sslParam) ||
    sslNegotiation === 'direct' ||
    isNeonHost ||
    options.sslRejectUnauthorized !== undefined;

  if (!shouldUseSsl) {
    return config;
  }

  // Enable SCRAM-SHA-256-PLUS channel binding over TLS when requested
  if (channelBinding === 'require' || channelBinding === 'prefer') {
    config.enableChannelBinding = true;
  }

  // When custom CA/client cert files are provided via query params, preserve the
  // raw connectionString so pg-connection-string can read them from disk.
  if (hasCertFiles) {
    return config;
  }

  let rejectUnauthorized = true;
  if (options.sslRejectUnauthorized !== undefined) {
    rejectUnauthorized = options.sslRejectUnauthorized;
  } else if (sslMode === 'no-verify' || sslParam === 'no-verify') {
    rejectUnauthorized = false;
  } else if (useLibpqCompat && (sslMode === 'require' || sslMode === 'prefer')) {
    rejectUnauthorized = false;
  }

  // pg's ConnectionParameters runs Object.assign(config, parse(connectionString)),
  // so strip SSL/channel-binding/negotiation query params after resolving them here
  // to prevent parse(connectionString) from overwriting config.ssl or emitting warnings.
  params.delete('sslmode');
  params.delete('ssl');
  params.delete('uselibpqcompat');
  params.delete('channel_binding');
  params.delete('sslnegotiation');

  config.connectionString = parsedUrl.toString();
  config.ssl = { rejectUnauthorized };

  return config;
}

class ResilientPool extends Pool {
  override connect(): Promise<PoolClient>;
  override connect(
    callback: (err: Error | undefined, client: PoolClient | undefined, done: (release?: any) => void) => void
  ): void;
  override connect(
    callback?: (err: Error | undefined, client: PoolClient | undefined, done: (release?: any) => void) => void
  ): Promise<PoolClient> | void {
    const attemptConnect = (attempt: number, maxAttempts: number): Promise<PoolClient> => {
      return super.connect().catch(async (err) => {
        if (!this.ending && isTransientConnectionError(err) && attempt < maxAttempts) {
          const delayMs = attempt * 750;
          logger.warn(
            {
              attempt,
              maxAttempts,
              delayMs,
              err: err instanceof Error ? err.message : String(err),
            },
            'Transient PostgreSQL connect error; retrying'
          );
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          return attemptConnect(attempt + 1, maxAttempts);
        }
        throw err;
      });
    };

    const promise = attemptConnect(1, 3);
    if (callback) {
      promise.then(
        (client) => callback(undefined, client, (release?: any) => client.release(release)),
        (err) => callback(err as Error, undefined, () => {})
      );
      return;
    }
    return promise;
  }
}

export const pool: Pool = new ResilientPool(
  buildPgPoolConfig({
    databaseUrl: env.DATABASE_URL,
    max: env.DATABASE_POOL_MAX,
    connectionTimeoutMillis: env.DATABASE_CONNECTION_TIMEOUT_MS,
    sslRejectUnauthorized: env.DATABASE_SSL_REJECT_UNAUTHORIZED,
  })
);

pool.on('error', (err: Error) => {
  logger.error({ err }, 'Unexpected idle client error on PostgreSQL pool');
});

/**
 * Verifies PostgreSQL readiness with bounded backoff retries on transient
 * connection errors (such as Neon serverless compute cold starts).
 */
export async function waitForDatabaseReady(
  maxAttempts = 3,
  baseDelayMs = 1000
): Promise<void> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (err) {
      lastError = err;
      if (!isTransientConnectionError(err) || attempt >= maxAttempts) {
        throw err;
      }

      const delayMs = baseDelayMs * attempt;
      logger.warn(
        {
          attempt,
          maxAttempts,
          delayMs,
          err: err instanceof Error ? err.message : String(err),
        },
        'Transient PostgreSQL connection failure while waiting for readiness; retrying'
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw lastError;
}

async function acquireHealthyTransactionClient(maxAttempts = 3): Promise<PoolClient> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let client: PoolClient | undefined;
    try {
      client = await pool.connect();
      await client.query('BEGIN');
      return client;
    } catch (err) {
      lastError = err;
      if (client) {
        try {
          client.release(true);
        } catch {
          // Ignore double-release if already released
        }
      }

      if (!isTransientConnectionError(err) || attempt >= maxAttempts) {
        throw err;
      }

      const delayMs = attempt * 750;
      logger.warn(
        {
          attempt,
          maxAttempts,
          delayMs,
          err: err instanceof Error ? err.message : String(err),
        },
        'Transient PostgreSQL connection failure before transaction start; retrying'
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw lastError;
}

export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await acquireHealthyTransactionClient();
  let clientErrored = false;

  const onClientError = (err: Error) => {
    clientErrored = true;
    logger.warn({ err }, 'Checked-out PostgreSQL client encountered an error');
  };
  client.on('error', onClientError);

  try {
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    clientErrored = clientErrored || isTransientConnectionError(err);
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      clientErrored = true;
      logger.error({ rollbackErr }, 'Failed to rollback transaction');
    }
    throw err;
  } finally {
    client.removeListener('error', onClientError);
    client.release(clientErrored || undefined);
  }
}

export async function closePool(): Promise<void> {
  await pool.end();
}
