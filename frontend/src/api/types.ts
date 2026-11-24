export interface HealthCheckResponse {
  status: string;
  checks: {
    postgres: boolean;
    redis: boolean;
  };
}

export interface CircuitBreakerStatus {
  endpoint_id: string;
  endpoint_name: string;
  state: 'closed' | 'open' | 'half_open' | string;
  consecutive_failures: number;
  open_until: string | null;
}

export interface DashboardMetrics {
  deliveries_by_status: Record<string, number>;
  total_deliveries: number;
  success_rate: number;
  average_latency_ms: number;
  outbox_backlog: number;
  oldest_due_delivery_age_sec: number;
  circuit_breakers: CircuitBreakerStatus[];
}

export interface DeliveryPolicy {
  max_attempts: number;
  attempt_timeout_ms: number;
  max_in_flight: number;
}

export interface Endpoint {
  id: string;
  name: string;
  url: string;
  description?: string | null;
  status: 'active' | 'disabled';
  rate_limit_per_minute: number;
  circuit_breaker_state: 'closed' | 'open' | 'half_open';
  created_at: string;
  updated_at: string;
  subscriptions: string[];
  policy?: DeliveryPolicy;
  signing_secret?: string;
}

export interface CreateEndpointInput {
  name: string;
  url: string;
  description?: string;
  subscriptions: string[];
  rate_limit_per_minute?: number;
  policy?: Partial<DeliveryPolicy>;
}

export interface UpdateEndpointInput {
  name?: string;
  url?: string;
  description?: string;
  subscriptions?: string[];
  status?: 'active' | 'disabled';
  rate_limit_per_minute?: number;
  policy?: Partial<DeliveryPolicy>;
}

export interface DeliverySummary {
  id: string;
  event_id: string;
  endpoint_id: string;
  endpoint_name: string;
  event_type: string;
  status: 'pending' | 'in_progress' | 'succeeded' | 'failed' | 'dead_letter';
  attempt_count: number;
  max_attempts: number;
  last_http_status: number | null;
  last_failure_class: string | null;
  next_retry_at: string | null;
  replay_of_delivery_id: string | null;
  replay_number: number;
  created_at: string;
  updated_at: string;
}

export interface DeliveryAttemptDetail {
  id: string;
  attempt_number: number;
  http_status: number | null;
  failure_class: string | null;
  latency_ms: number | null;
  request_headers: Record<string, string>;
  response_headers: Record<string, string>;
  response_body_excerpt: string | null;
  created_at: string;
}

export interface DeadLetterInfo {
  reason: string;
  final_error: string;
  failed_at: string;
}

export interface DeliveryDetail extends DeliverySummary {
  endpoint_url: string;
  payload: any;
  dead_letter?: DeadLetterInfo | null;
  attempts: DeliveryAttemptDetail[];
}

export interface IngestEventInput {
  type: string;
  data?: any;
  payload?: any;
  api_version?: string;
}

export interface IngestEventResponse {
  event_id: string;
  status: string;
  idempotent_replay: boolean;
  deliveries_created: number;
}

export interface IncidentDiagnosis {
  incident_title: string;
  fault_domain: 'merchant_endpoint' | 'network_infra' | 'hookforge_policy' | 'payload_content';
  severity: 'low' | 'medium' | 'high' | 'critical';
  confidence: number;
  root_cause_explanation: string;
  ambiguous_delivery_warning: boolean;
  recommended_operator_actions: string[];
  suggested_policy_adjustment: {
    max_attempts?: number;
    attempt_timeout_ms?: number;
    max_in_flight?: number;
    backoff_strategy?: string;
  } | null;
  merchant_issue_summary: string;
}

export interface EndpointHealthReport {
  overall_health: 'healthy' | 'degraded' | 'failing';
  summary: string;
  observed_patterns: string[];
  recommended_actions: string[];
  suggested_policy: {
    max_attempts?: number;
    attempt_timeout_ms?: number;
    max_in_flight?: number;
  };
}

export interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
    details?: any;
  };
}
