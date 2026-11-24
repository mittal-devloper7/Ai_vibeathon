import { ssrfGuard } from '../../engine/delivery/ssrfGuard.js';
import { generateSigningSecret, encryptSecret } from '../../shared/crypto.js';
import { NotFoundError } from '../../shared/errors.js';
import {
  endpointsRepository,
  CreateEndpointDto,
  UpdateEndpointDto,
  EndpointRecord,
} from './endpoints.repository.js';

export interface EndpointResponseDto extends EndpointRecord {
  signing_secret?: string;
}

export class EndpointsService {
  /**
   * Validates URL, generates encrypted signing secret, and creates endpoint.
   * Plaintext signing_secret is returned ONLY here.
   */
  public async createEndpoint(
    organizationId: string,
    dto: CreateEndpointDto
  ): Promise<EndpointResponseDto> {
    // 1. SSRF Validation
    await ssrfGuard.validateUrl(dto.url);

    // 2. Generate signing secret & AES-256-GCM encryption
    const { secret: plaintextSecret, keyId } = generateSigningSecret();
    const encryptedSecret = encryptSecret(plaintextSecret);

    // 3. Insert in repository
    const endpoint = await endpointsRepository.createEndpoint(
      organizationId,
      dto,
      encryptedSecret,
      keyId
    );

    return {
      ...endpoint,
      signing_secret: plaintextSecret,
    };
  }

  /**
   * Fetches an endpoint by ID. Never returns secret.
   */
  public async getEndpoint(organizationId: string, endpointId: string): Promise<EndpointRecord> {
    const endpoint = await endpointsRepository.findById(organizationId, endpointId);
    if (!endpoint) {
      throw new NotFoundError('Endpoint not found');
    }
    return endpoint;
  }

  /**
   * Lists all endpoints for the authenticated organization. Never returns secrets.
   */
  public async listEndpoints(organizationId: string): Promise<EndpointRecord[]> {
    return endpointsRepository.listByOrg(organizationId);
  }

  /**
   * Updates endpoint configuration. Runs SSRF guard if URL changed. Never returns secret.
   */
  public async updateEndpoint(
    organizationId: string,
    endpointId: string,
    dto: UpdateEndpointDto
  ): Promise<EndpointRecord> {
    if (dto.url) {
      await ssrfGuard.validateUrl(dto.url);
    }

    const updated = await endpointsRepository.updateEndpoint(organizationId, endpointId, dto);
    if (!updated) {
      throw new NotFoundError('Endpoint not found');
    }

    return updated;
  }

  /**
   * Rotates an endpoint's signing secret and returns the new plaintext secret once.
   */
  public async rotateSecret(
    organizationId: string,
    endpointId: string
  ): Promise<{ endpoint_id: string; signing_key_id: string; signing_secret: string }> {
    const existing = await endpointsRepository.findById(organizationId, endpointId);
    if (!existing) {
      throw new NotFoundError('Endpoint not found');
    }

    const { secret: plaintextSecret, keyId } = generateSigningSecret();
    const encryptedSecret = encryptSecret(plaintextSecret);

    await endpointsRepository.rotateSecret(organizationId, endpointId, encryptedSecret, keyId);

    return {
      endpoint_id: endpointId,
      signing_key_id: keyId,
      signing_secret: plaintextSecret,
    };
  }
}

export const endpointsService = new EndpointsService();
