import { Redis, RedisOptions } from 'ioredis';
import { env } from '../config/env.js';
import { logger } from '../shared/logger.js';

/**
 * Returns connection options configured for BullMQ compatibility
 * (specifically maxRetriesPerRequest: null and enableReadyCheck: false).
 */
export function getRedisConnectionOptions(): RedisOptions {
  return {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    retryStrategy(times) {
      const delay = Math.min(times * 50, 2000);
      return delay;
    },
  };
}

/**
 * Factory function creating a new ioredis connection with BullMQ-compatible settings.
 */
export function createRedisClient(): Redis {
  const client = new Redis(env.REDIS_URL, getRedisConnectionOptions());

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
