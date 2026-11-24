import Joi from 'joi';

export const ingestEventSchema = Joi.object({
  type: Joi.string()
    .pattern(/^[a-z0-9_-]+(\.[a-z0-9_-]+)+$/)
    .required()
    .messages({
      'any.required': 'Event type is required',
      'string.pattern.base': 'Event type must be dot-separated lowercase words (e.g., payment.success, order.created.v1)',
    }),
  api_version: Joi.string().max(50).default('2026-11-01'),
  occurred_at: Joi.string().isoDate().optional(),
  data: Joi.object().required().messages({
    'any.required': 'Event data payload is required',
    'object.base': 'Event data must be a valid JSON object',
  }),
});

export const listEventsQuerySchema = Joi.object({
  limit: Joi.number().integer().min(1).max(100).default(20),
  cursor: Joi.string().uuid().optional(),
  event_type: Joi.string().trim().optional(),
});
