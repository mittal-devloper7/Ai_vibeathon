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

const RENDER_API_URL = 'https://ai-vibeathon.onrender.com/api/v1';

export function normalizeApiBaseUrl(raw?: string | null): string {
  const cleaned = (raw || '').trim().replace(/\/+$/, '');
  if (!cleaned) {
    if (typeof window !== 'undefined' && window.location.hostname.endsWith('vercel.app')) {
      return RENDER_API_URL;
    }
    return 'http://localhost:3000/api/v1';
  }
  return cleaned.endsWith('/api/v1') ? cleaned : `${cleaned}/api/v1`;
}

export const DEFAULT_API_URL = normalizeApiBaseUrl(import.meta.env.VITE_API_BASE_URL);
export const DEFAULT_API_KEY = 'hf_live_demo1234567890abcdef12345678';

export function getStoredApiUrl(): string {
  try {
    const stored = localStorage.getItem('hf_api_url')?.trim().replace(/\/+$/, '');
    if (!stored) {
      return DEFAULT_API_URL;
    }
    if (
      typeof window !== 'undefined' &&
      window.location.protocol === 'https:' &&
      /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i.test(stored)
    ) {
      return DEFAULT_API_URL;
    }
    return normalizeApiBaseUrl(stored);
  } catch {
    return DEFAULT_API_URL;
  }
}

export function setStoredApiUrl(url: string): void {
  try {
    const cleaned = url.trim().replace(/\/+$/, '');
    if (!cleaned) {
      localStorage.removeItem('hf_api_url');
      return;
    }
    localStorage.setItem('hf_api_url', normalizeApiBaseUrl(cleaned));
  } catch {
    // Ignore storage access errors in restricted browsing modes
  }
}

export function getStoredApiKey(): string {
  try {
    return localStorage.getItem('hf_api_key')?.trim() || DEFAULT_API_KEY;
  } catch {
    return DEFAULT_API_KEY;
  }
}

export function setStoredApiKey(key: string): void {
  try {
    localStorage.setItem('hf_api_key', key.trim());
  } catch {
    // Ignore storage access errors in restricted browsing modes
  }
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

async function parseResponseBody(response: Response): Promise<{ isJson: boolean; data: any }> {
  const contentType = response.headers.get('content-type') || '';
  const text = await response.text().catch(() => '');

  if (contentType.includes('application/json') && text) {
    try {
      return { isJson: true, data: JSON.parse(text) };
    } catch {
      return { isJson: false, data: text };
    }
  }

  return { isJson: false, data: text };
}

async function request<T>(
  path: string,
  options: {
    method?: string;
    body?: any;
    headers?: Record<string, string>;
    overrideUrl?: string;
    timeoutMs?: number;
    allowDegradedHealth?: boolean;
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

  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? 35000;
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(url, {
      method: options.method || 'GET',
      headers,
      body: options.body && !(options.body instanceof FormData) ? JSON.stringify(options.body) : options.body,
      signal: controller.signal,
    });
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err?.name === 'AbortError') {
      throw new ApiError(
        504,
        'REQUEST_TIMEOUT',
        'Backend request timed out (server may be waking up from cold start). Please retry.'
      );
    }
    throw new ApiError(
      0,
      'NETWORK_ERROR',
      'Unable to reach the backend API. Check your API Base URL, CORS configuration, or wait ~30s for cold start.'
    );
  } finally {
    clearTimeout(timeoutId);
  }

  const { isJson, data } = await parseResponseBody(response);

  if (options.allowDegradedHealth && response.status === 503 && isJson && data?.checks) {
    return data as T;
  }

  if (!response.ok) {
    if (isJson && data?.error) {
      throw new ApiError(
        response.status,
        data.error.code || 'UNKNOWN_ERROR',
        data.error.message || 'API request failed',
        data.error.details
      );
    }
    const fallbackMessage =
      response.status >= 502 && response.status <= 504
        ? `Backend returned HTTP ${response.status} (service may be starting up). Please retry in a few seconds.`
        : typeof data === 'string' && data
          ? data
          : `API request failed with HTTP ${response.status}`;
    throw new ApiError(response.status, 'HTTP_ERROR', fallbackMessage);
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
      timeoutMs: 45000,
      allowDegradedHealth: true,
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
      timeoutMs: 45000,
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
      timeoutMs: 45000,
    });
    return {
      ...res,
      recommended_operator_actions: Array.isArray(res?.recommended_operator_actions)
        ? res.recommended_operator_actions
        : [],
    };
  },
};
