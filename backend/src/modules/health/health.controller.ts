import net from 'node:net';
import { Request, Response } from 'express';
import { pool } from '../../database/pool.js';
import { env } from '../../config/env.js';
import { logger } from '../../shared/logger.js';

function checkRedisConnectivity(redisUrl: string, timeoutMs = 2000): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const parsed = new URL(redisUrl);
      const port = parseInt(parsed.port || '6379', 10);
      const host = parsed.hostname || '127.0.0.1';
      const socket = new net.Socket();
      let resolved = false;

      const finish = (isHealthy: boolean) => {
        if (!resolved) {
          resolved = true;
          socket.destroy();
          resolve(isHealthy);
        }
      };

      socket.setTimeout(timeoutMs);

      socket.on('connect', () => {
        if (parsed.password) {
          socket.write(`AUTH ${parsed.password}\r\n`);
        }
        socket.write('PING\r\n');
      });

      socket.on('data', (data) => {
        const response = data.toString();
        if (response.includes('+PONG')) {
          finish(true);
        } else if (response.includes('+OK')) {
          socket.write('PING\r\n');
        } else {
          finish(false);
        }
      });

      socket.on('timeout', () => finish(false));
      socket.on('error', () => finish(false));
      socket.on('close', () => finish(false));

      socket.connect(port, host);
    } catch {
      resolve(false);
    }
  });
}

export class HealthController {
  public static getLive(_req: Request, res: Response): void {
    res.status(200).json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    });
  }

  public static async getReady(_req: Request, res: Response): Promise<void> {
    let pgHealthy = false;
    let redisHealthy = false;

    // Check PostgreSQL
    try {
      const result = await pool.query('SELECT 1 AS ready;');
      pgHealthy = result.rows[0]?.ready === 1;
    } catch (err) {
      logger.warn({ err }, 'Health ready check: PostgreSQL ping failed');
      pgHealthy = false;
    }

    // Check Redis
    try {
      redisHealthy = await checkRedisConnectivity(env.REDIS_URL, 2000);
    } catch (err) {
      logger.warn({ err }, 'Health ready check: Redis ping failed');
      redisHealthy = false;
    }

    const isReady = pgHealthy && redisHealthy;
    const statusCode = isReady ? 200 : 503;

    res.status(statusCode).json({
      status: isReady ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      services: {
        postgres: pgHealthy ? 'up' : 'down',
        redis: redisHealthy ? 'up' : 'down',
      },
      checks: {
        postgres: pgHealthy,
        redis: redisHealthy,
      },
    });
  }
}
