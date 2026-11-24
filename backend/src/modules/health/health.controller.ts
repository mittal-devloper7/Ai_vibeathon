import net from 'node:net';
import tls from 'node:tls';
import { Request, Response } from 'express';
import { pool } from '../../database/pool.js';
import { env } from '../../config/env.js';
import { logger } from '../../shared/logger.js';

function checkRedisConnectivity(redisUrl: string, timeoutMs = 5000): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const parsed = new URL(redisUrl);
      const port = parseInt(parsed.port || '6379', 10);
      const host = parsed.hostname || '127.0.0.1';
      const isTls = parsed.protocol === 'rediss:';
      const socket: net.Socket | tls.TLSSocket = isTls
        ? tls.connect({ host, port, servername: host })
        : net.connect({ host, port });

      let resolved = false;
      let responseBuffer = '';

      const finish = (isHealthy: boolean) => {
        if (!resolved) {
          resolved = true;
          socket.destroy();
          resolve(isHealthy);
        }
      };

      socket.setTimeout(timeoutMs);

      const sendPing = () => {
        if (parsed.password) {
          const password = decodeURIComponent(parsed.password);
          if (parsed.username) {
            const username = decodeURIComponent(parsed.username);
            socket.write(`AUTH ${username} ${password}\r\n`);
          } else {
            socket.write(`AUTH ${password}\r\n`);
          }
        }
        socket.write('PING\r\n');
      };

      socket.on(isTls ? 'secureConnect' : 'connect', sendPing);

      socket.on('data', (data) => {
        responseBuffer += data.toString();
        if (responseBuffer.includes('+PONG')) {
          finish(true);
        } else if (responseBuffer.includes('-ERR') || responseBuffer.includes('-NOAUTH') || responseBuffer.includes('-WRONGPASS')) {
          finish(false);
        }
      });

      socket.on('timeout', () => finish(false));
      socket.on('error', () => finish(false));
      socket.on('close', () => finish(false));
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
      redisHealthy = await checkRedisConnectivity(env.REDIS_URL, 5000);
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
