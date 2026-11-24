import Joi from 'joi';

const policySchema = Joi.object({
  max_attempts: Joi.number().integer().min(1).max(10).default(5),
  attempt_timeout_ms: Joi.number().integer().min(500).max(30000).default(10000),
  max_in_flight: Joi.number().integer().min(1).max(100).default(10),
});

export const createEndpointSchema = Joi.object({
  name: Joi.string().trim().min(1).max(255).required().messages({
    'any.required': 'Endpoint name is required',
    'string.empty': 'Endpoint name cannot be empty',
  }),
  url: Joi.string().uri({ scheme: ['http', 'https'] }).required().messages({
    'any.required': 'Destination URL is required',
    'string.uri': 'Destination URL must be a valid HTTP or HTTPS URI',
  }),
  description: Joi.string().max(1000).allow('', null).optional(),
  subscriptions: Joi.array()
    .items(Joi.string().trim().min(1).max(100))
    .min(1)
    .unique()
    .required()
    .messages({
      'any.required': 'At least one event subscription pattern is required',
      'array.min': 'At least one event subscription pattern is required',
      'array.unique': 'Subscription event types must be unique',
    }),
  rate_limit_per_minute: Joi.number().integer().min(1).max(10000).default(600),
  policy: policySchema.default({
    max_attempts: 5,
    attempt_timeout_ms: 10000,
    max_in_flight: 10,
  }),
});

export const updateEndpointSchema = Joi.object({
  name: Joi.string().trim().min(1).max(255).optional(),
  url: Joi.string().uri({ scheme: ['http', 'https'] }).optional(),
  description: Joi.string().max(1000).allow('', null).optional(),
  status: Joi.string().valid('active', 'disabled').optional(),
  subscriptions: Joi.array()
    .items(Joi.string().trim().min(1).max(100))
    .min(1)
    .unique()
    .optional(),
  rate_limit_per_minute: Joi.number().integer().min(1).max(10000).optional(),
  policy: policySchema.optional(),
}).min(1).messages({
  'object.min': 'At least one field must be provided for update',
});

export const endpointIdParamSchema = Joi.object({
  endpointId: Joi.string().uuid().required().messages({
    'string.guid': 'Endpoint ID must be a valid UUID',
    'any.required': 'Endpoint ID is required',
  }),
});
