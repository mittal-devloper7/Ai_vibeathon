import { app } from './app.js';
import { env } from './config/env.js';
import { closePool } from './database/pool.js';
import { logger } from './shared/logger.js';

const server = app.listen(env.PORT, () => {
  logger.info(`HookForge server listening on port ${env.PORT} in ${env.NODE_ENV} mode`);
});

let isShuttingDown = false;

async function handleShutdown(signal: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  logger.info(`Received ${signal}. Initiating graceful shutdown...`);

  // Close HTTP server to stop accepting new requests
  server.close(async (err) => {
    if (err) {
      logger.error({ err }, 'Error occurred while closing HTTP server');
    } else {
      logger.info('HTTP server closed');
    }

    try {
      await closePool();
      logger.info('PostgreSQL connection pool closed');
    } catch (poolErr) {
      logger.error({ poolErr }, 'Error occurred while closing PostgreSQL pool');
    }

    process.exit(0);
  });

  // Force exit after 10 seconds if hanging
  setTimeout(() => {
    logger.error('Graceful shutdown timeout exceeded. Forcing exit.');
    process.exit(1);
  }, 10000).unref();
}

process.on('SIGTERM', () => handleShutdown('SIGTERM'));
process.on('SIGINT', () => handleShutdown('SIGINT'));

export { server };
