import {
  HealthCheckResponse,
  DashboardMetrics,
  Endpoint,
  CreateEndpointInput,
  UpdateEndpointInput,
  DeliverySummary,
  DeliveryDetail,
  IngestEventInput,
  IngestEventResponse,
  IncidentDiagnosis,
  EndpointHealthReport,
} from './types';

export const DEFAULT_API_URL = 'http://localhost:3000/api/v1';
export const DEFAULT_API_KEY = 'hf_live_demo1234567890abcdef12345678';

export function getStoredApiUrl(): string {
  return localStorage.getItem('hf_api_url') || DEFAULT_API_URL;
}

export function setStoredApiUrl(url: string): void {
  localStorage.setItem('hf_api_url', url.trim().replace(/\/+$/, ''));
}

export function getStoredApiKey(): string {
  return localStorage.getItem('hf_api_key') || DEFAULT_API_KEY;
}

export function setStoredApiKey(key: string): void {
  localStorage.setItem('hf_api_key', key.trim());
}

export class ApiError extends Error {
  code: string;
  status: number;
  details?: any;

  constructor(status: number, code: string, message: string, details?: any) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function request<T>(
  path: string,
  options: {
    method?: string;
    body?: any;
    headers?: Record<string, string>;
    overrideUrl?: string;
  } = {}
): Promise<T> {
  const baseUrl = options.overrideUrl || getStoredApiUrl();
  const apiKey = getStoredApiKey();

  const url = path.startsWith('http') ? path : `${baseUrl}${path}`;
  const headers: Record<string, string> = {
    'Accept': 'application/json',
    ...(apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {}),
    ...(options.headers || {}),
  };

  if (options.body && !(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(url, {
    method: options.method || 'GET',
    headers,
    body: options.body && !(options.body instanceof FormData) ? JSON.stringify(options.body) : options.body,
  });

  const contentType = response.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json');
  const data = isJson ? await response.json() : await response.text();

  if (!response.ok) {
    if (isJson && data?.error) {
      throw new ApiError(response.status, data.error.code || 'UNKNOWN_ERROR', data.error.message || 'API request failed', data.error.details);
    }
    throw new ApiError(response.status, 'HTTP_ERROR', typeof data === 'string' ? data : 'API request failed');
  }

  return data as T;
}

export const api = {
  async checkHealth(): Promise<HealthCheckResponse> {
    const apiUrl = getStoredApiUrl();
    const origin = apiUrl.replace(/\/api\/v1\/?$/, '');
    return request<HealthCheckResponse>(`${origin}/health/ready`, {
      headers: {},
      overrideUrl: `${origin}/health/ready`,
    });
  },

  async getMetrics(): Promise<DashboardMetrics> {
    const res = await request<any>('/dashboard/metrics');
    return {
      deliveries_by_status: res?.deliveries_by_status || {},
      total_deliveries: Number(res?.total_deliveries) || 0,
      success_rate: Number(res?.success_rate) || 0,
      average_latency_ms: Number(res?.average_latency_ms) || 0,
      outbox_backlog: Number(res?.outbox_backlog) || 0,
      oldest_due_delivery_age_sec: Number(res?.oldest_due_delivery_age_sec) || 0,
      circuit_breakers: Array.isArray(res?.circuit_breakers) ? res.circuit_breakers : [],
    };
  },

  async listEndpoints(): Promise<Endpoint[]> {
    const res = await request<any>('/endpoints');
    if (Array.isArray(res)) {
      return res;
    }
    if (res && Array.isArray(res.data)) {
      return res.data;
    }
    if (res && Array.isArray(res.endpoints)) {
      return res.endpoints;
    }
    return [];
  },

  async createEndpoint(input: CreateEndpointInput): Promise<Endpoint> {
    return request<Endpoint>('/endpoints', {
      method: 'POST',
      body: input,
    });
  },

  async updateEndpoint(id: string, input: UpdateEndpointInput): Promise<Endpoint> {
    return request<Endpoint>(`/endpoints/${id}`, {
      method: 'PATCH',
      body: input,
    });
  },

  async rotateSecret(id: string): Promise<{ signing_secret: string }> {
    return request<{ signing_secret: string }>(`/endpoints/${id}/rotate-secret`, {
      method: 'POST',
    });
  },

  async getEndpointHealthReport(id: string, forceRefresh = false): Promise<EndpointHealthReport> {
    const res = await request<any>(`/endpoints/${id}/health-report`, {
      method: 'POST',
      body: { force_refresh: forceRefresh },
    });
    return {
      ...res,
      observed_patterns: Array.isArray(res?.observed_patterns) ? res.observed_patterns : [],
      recommended_actions: Array.isArray(res?.recommended_actions) ? res.recommended_actions : [],
    };
  },

  async publishEvent(body: IngestEventInput, idempotencyKey?: string): Promise<IngestEventResponse> {
    const headers: Record<string, string> = {};
    if (idempotencyKey) {
      headers['Idempotency-Key'] = idempotencyKey;
    }
    return request<IngestEventResponse>('/events', {
      method: 'POST',
      body,
      headers,
    });
  },

  async listDeliveries(params?: {
    status?: string;
    endpoint_id?: string;
    limit?: number;
    offset?: number;
  }): Promise<DeliverySummary[]> {
    const query = new URLSearchParams();
    if (params?.status) query.set('status', params.status);
    if (params?.endpoint_id) query.set('endpoint_id', params.endpoint_id);
    if (params?.limit) query.set('limit', params.limit.toString());
    if (params?.offset) query.set('offset', params.offset.toString());
    const qs = query.toString();
    const res = await request<any>(`/deliveries${qs ? `?${qs}` : ''}`);
    if (Array.isArray(res)) {
      return res;
    }
    if (res && Array.isArray(res.data)) {
      return res.data;
    }
    if (res && Array.isArray(res.deliveries)) {
      return res.deliveries;
    }
    return [];
  },

  async getDelivery(id: string): Promise<DeliveryDetail> {
    const res = await request<any>(`/deliveries/${id}`);
    return {
      ...res,
      attempts: Array.isArray(res?.attempts) ? res.attempts : [],
    };
  },

  async replayDelivery(id: string, reason?: string): Promise<{
    delivery_id: string;
    replay_of_delivery_id: string;
    replay_number: number;
    status: string;
  }> {
    return request(`/deliveries/${id}/replay`, {
      method: 'POST',
      body: { reason: reason || 'Manual operator replay from UI' },
    });
  },

  async diagnoseDelivery(id: string, forceRefresh = false): Promise<IncidentDiagnosis> {
    const res = await request<any>(`/deliveries/${id}/diagnose`, {
      method: 'POST',
      body: { force_refresh: forceRefresh },
    });
    return {
      ...res,
      recommended_operator_actions: Array.isArray(res?.recommended_operator_actions)
        ? res.recommended_operator_actions
        : [],
    };
  },
};
