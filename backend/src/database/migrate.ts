import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool, withTransaction } from './pool.js';
import { logger } from '../shared/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function runMigrations(): Promise<string[]> {
  logger.info('Starting database migration runner...');

  // Ensure schema_migrations table exists
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id SERIAL PRIMARY KEY,
      filename VARCHAR(255) NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  const migrationsDir = path.join(__dirname, 'migrations');
  const files = await fs.readdir(migrationsDir);
  const sqlFiles = files.filter((f) => f.endsWith('.sql')).sort();

  const { rows: appliedRows } = await pool.query<{ filename: string }>(
    'SELECT filename FROM schema_migrations ORDER BY id ASC'
  );
  const appliedSet = new Set(appliedRows.map((r) => r.filename));

  const executed: string[] = [];

  for (const file of sqlFiles) {
    if (appliedSet.has(file)) {
      logger.info({ file }, 'Migration already applied, skipping');
      continue;
    }

    const filePath = path.join(migrationsDir, file);
    const sqlContent = await fs.readFile(filePath, 'utf8');

    logger.info({ file }, 'Applying migration');

    await withTransaction(async (client) => {
      await client.query(sqlContent);
      await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
    });

    executed.push(file);
    logger.info({ file }, 'Migration applied successfully');
  }

  logger.info({ newlyApplied: executed.length }, 'Migration runner completed successfully');
  return executed;
}

const isDirectRun = process.argv[1]?.replace(/\\/g, '/').endsWith('src/database/migrate.ts') ||
                    process.argv[1]?.replace(/\\/g, '/').endsWith('dist/database/migrate.js');

if (isDirectRun) {
  runMigrations()
    .then(async () => {
      await pool.end();
      process.exit(0);
    })
    .catch(async (err) => {
      logger.error({ err }, 'Migration runner failed');
      await pool.end();
      process.exit(1);
    });
}
