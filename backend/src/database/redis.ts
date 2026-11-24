import { Redis, RedisOptions } from 'ioredis';
import { env } from '../config/env.js';
import { logger } from '../shared/logger.js';

/**
 * Returns connection options parsed from REDIS_URL and configured for
 * BullMQ compatibility (supports both local redis:// and TLS rediss:// such as Upstash).
 */
export function getRedisConnectionOptions(redisUrl: string = env.REDIS_URL): RedisOptions {
  const parsed = new URL(redisUrl);
  const port = parsed.port ? parseInt(parsed.port, 10) : 6379;
  const dbPath = parsed.pathname.replace(/^\//, '');
  const db = dbPath ? parseInt(dbPath, 10) : undefined;

  const options: RedisOptions = {
    host: parsed.hostname || '127.0.0.1',
    port: Number.isFinite(port) ? port : 6379,
    connectTimeout: 15000,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    retryStrategy(times) {
      const delay = Math.min(times * 50, 2000);
      return delay;
    },
  };

  if (parsed.username) {
    options.username = decodeURIComponent(parsed.username);
  }
  if (parsed.password) {
    options.password = decodeURIComponent(parsed.password);
  }
  if (db !== undefined && Number.isFinite(db)) {
    options.db = db;
  }
  if (parsed.protocol === 'rediss:') {
    options.tls = {
      servername: parsed.hostname,
    };
  }

  return options;
}

/**
 * Factory function creating a new ioredis connection with BullMQ-compatible settings.
 */
export function createRedisClient(): Redis {
  const client = new Redis(getRedisConnectionOptions());

  client.on('error', (err) => {
    logger.error({ err }, 'Redis connection error');
  });

  return client;
}

let sharedClient: Redis | null = null;

// Shared Redis client for lightweight operations / health (lazy initialized)
export function getSharedRedisClient(): Redis {
  if (!sharedClient) {
    sharedClient = createRedisClient();
  }
  return sharedClient;
}

/**
 * Closes the shared Redis client gracefully if open.
 */
export async function closeRedis(): Promise<void> {
  if (sharedClient) {
    try {
      await sharedClient.quit();
    } catch {
      sharedClient.disconnect();
    }
    sharedClient = null;
  }
}
