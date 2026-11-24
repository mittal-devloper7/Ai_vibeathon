import { OutboxPublisher } from './engine/outbox/outboxPublisher.js';
import { DeliveryWorker } from './engine/workers/deliveryWorker.js';
import { Reconciler } from './engine/workers/reconciler.js';
import { closeRedis } from './database/redis.js';
import { closePool } from './database/pool.js';
import { logger } from './shared/logger.js';

logger.info('HookForge background worker process starting...');

const outboxPublisher = new OutboxPublisher();
const deliveryWorker = new DeliveryWorker();
const reconciler = new Reconciler();

// Start Outbox publisher polling loop
outboxPublisher.start(250);

// Start periodic Reconciler (default 5000ms)
reconciler.start(5000);

let isShuttingDown = false;

async function handleShutdown(signal: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  logger.info(`Received ${signal}. Shutting down worker process...`);

  try {
    await reconciler.stop();
    await outboxPublisher.stop();
    await deliveryWorker.close();
    await closeRedis();
    await closePool();
    logger.info('Worker process exited cleanly.');
    process.exit(0);
  } catch (err) {
    logger.error({ err }, 'Error during worker shutdown');
    process.exit(1);
  }
}

process.on('SIGTERM', () => handleShutdown('SIGTERM'));
process.on('SIGINT', () => handleShutdown('SIGINT'));
