import { Request, Response, NextFunction } from 'express';
import { pool } from '../database/pool.js';
import { sha256Hex } from '../shared/crypto.js';
import { UnauthenticatedError } from '../shared/errors.js';

export async function authMiddleware(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthenticatedError('Missing or malformed Authorization header');
    }

    const token = authHeader.substring(7).trim();
    if (!token) {
      throw new UnauthenticatedError('Missing API key in Authorization header');
    }

    const keyHash = sha256Hex(token);

    const query = `
      SELECT ak.id AS api_key_id, ak.organization_id, ak.scopes, o.status AS org_status
      FROM api_keys ak
      JOIN organizations o ON o.id = ak.organization_id
      WHERE ak.key_hash = $1 AND ak.revoked_at IS NULL;
    `;

    const { rows } = await pool.query<{
      api_key_id: string;
      organization_id: string;
      scopes: string[];
      org_status: string;
    }>(query, [keyHash]);

    if (rows.length === 0) {
      throw new UnauthenticatedError('Invalid or revoked API key');
    }

    const row = rows[0]!;
    if (row.org_status !== 'active') {
      throw new UnauthenticatedError('Organization account is suspended');
    }

    req.auth = {
      organizationId: row.organization_id,
      apiKeyId: row.api_key_id,
      scopes: row.scopes || ['*'],
    };
    req.orgId = row.organization_id;

    next();
  } catch (err) {
    next(err);
  }
}
