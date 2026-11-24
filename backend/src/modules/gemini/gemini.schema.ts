import Joi from 'joi';

// Request query/body schemas
export const geminiRequestOptionsSchema = Joi.object({
  force_refresh: Joi.boolean().default(false),
}).options({ allowUnknown: false });

export const deliveryIdParamSchema = Joi.object({
  deliveryId: Joi.string().uuid().required().messages({
    'string.guid': 'deliveryId must be a valid UUID',
    'any.required': 'deliveryId is required',
  }),
});

export const endpointIdParamSchema = Joi.object({
  endpointId: Joi.string().uuid().required().messages({
    'string.guid': 'endpointId must be a valid UUID',
    'any.required': 'endpointId is required',
  }),
});

// Structured JSON output types & schemas
export type FaultDomain =
  | 'merchant_endpoint'
  | 'network_or_timeout'
  | 'endpoint_configuration'
  | 'security_policy'
  | 'rate_limiting';

export type IncidentSeverity = 'low' | 'medium' | 'high' | 'critical';
export type ConfidenceLevel = 'high' | 'medium' | 'low';

export interface IncidentDiagnosis {
  incident_title: string;
  fault_domain: FaultDomain;
  severity: IncidentSeverity;
  confidence: ConfidenceLevel;
  root_cause_explanation: string;
  ambiguous_delivery_warning: boolean;
  recommended_operator_actions: string[];
  suggested_policy_adjustment?: {
    attempt_timeout_ms?: number;
    max_attempts?: number;
    max_in_flight?: number;
    rationale?: string;
  };
  merchant_issue_summary: string;
}

export const incidentDiagnosisJoiSchema = Joi.object({
  incident_title: Joi.string().required(),
  fault_domain: Joi.string()
    .valid(
      'merchant_endpoint',
      'network_or_timeout',
      'endpoint_configuration',
      'security_policy',
      'rate_limiting'
    )
    .required(),
  severity: Joi.string().valid('low', 'medium', 'high', 'critical').required(),
  confidence: Joi.string().valid('high', 'medium', 'low').required(),
  root_cause_explanation: Joi.string().required(),
  ambiguous_delivery_warning: Joi.boolean().required(),
  recommended_operator_actions: Joi.array().items(Joi.string()).min(1).required(),
  suggested_policy_adjustment: Joi.object({
    attempt_timeout_ms: Joi.number().integer().min(500).max(60000).optional(),
    max_attempts: Joi.number().integer().min(1).max(20).optional(),
    max_in_flight: Joi.number().integer().min(1).max(100).optional(),
    rationale: Joi.string().optional(),
  }).optional(),
  merchant_issue_summary: Joi.string().required(),
}).unknown(true);

export type OverallHealth = 'healthy' | 'degraded' | 'critical';

export interface EndpointHealthReport {
  overall_health: OverallHealth;
  summary: string;
  observed_patterns: string[];
  recommended_actions: string[];
  suggested_policy?: {
    attempt_timeout_ms?: number;
    max_in_flight?: number;
    max_attempts?: number;
    rationale?: string;
  };
}

export const endpointHealthReportJoiSchema = Joi.object({
  overall_health: Joi.string().valid('healthy', 'degraded', 'critical').required(),
  summary: Joi.string().required(),
  observed_patterns: Joi.array().items(Joi.string()).required(),
  recommended_actions: Joi.array().items(Joi.string()).required(),
  suggested_policy: Joi.object({
    attempt_timeout_ms: Joi.number().integer().min(500).max(60000).optional(),
    max_in_flight: Joi.number().integer().min(1).max(100).optional(),
    max_attempts: Joi.number().integer().min(1).max(20).optional(),
    rationale: Joi.string().optional(),
  }).optional(),
}).unknown(true);
