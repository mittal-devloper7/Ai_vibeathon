import { canonicalizeJson, sha256Hex } from '../../shared/crypto.js';
import { PayloadTooLargeError } from '../../shared/errors.js';
import {
  eventsRepository,
  IngestionResult,
  EventRecord,
} from './events.repository.js';

export interface IngestEventDto {
  type: string;
  api_version?: string;
  occurred_at?: string;
  data: Record<string, unknown>;
}

const MAX_PAYLOAD_BYTES = 1048576; // 1 MB

export class EventsService {
  /**
   * Enforces payload size limit, computes canonical payload SHA-256 hash,
   * and coordinates single-transaction ingestion in repository.
   */
  public async ingestEvent(
    organizationId: string,
    dto: IngestEventDto,
    idempotencyKey?: string | null,
    headers?: Record<string, unknown>
  ): Promise<IngestionResult> {
    const rawPayloadString = JSON.stringify(dto);
    const byteLength = Buffer.byteLength(rawPayloadString, 'utf8');

    if (byteLength > MAX_PAYLOAD_BYTES) {
      throw new PayloadTooLargeError(
        `Payload size (${byteLength} bytes) exceeds maximum allowed size of 1MB`
      );
    }

    // Canonicalize data payload for deterministic hashing
    const canonicalPayload = canonicalizeJson(dto.data);
    const payloadSha256 = sha256Hex(canonicalPayload);

    const fullPayload: Record<string, unknown> = {
      type: dto.type,
      api_version: dto.api_version || '2026-11-01',
      occurred_at: dto.occurred_at || new Date().toISOString(),
      data: dto.data,
    };

    return eventsRepository.ingestEvent({
      organizationId,
      eventType: dto.type,
      idempotencyKey: idempotencyKey?.trim() || null,
      payload: fullPayload,
      payloadSha256,
      headers,
    });
  }

  /**
   * Lists events scoped to organization.
   */
  public async listEvents(
    organizationId: string,
    options: { limit: number; cursor?: string; event_type?: string }
  ): Promise<{ events: EventRecord[]; nextCursor: string | null }> {
    return eventsRepository.listEvents(organizationId, {
      limit: options.limit,
      cursor: options.cursor,
      eventType: options.event_type,
    });
  }
}

export const eventsService = new EventsService();
