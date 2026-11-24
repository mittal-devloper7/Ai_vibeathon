import Joi from 'joi';

export const listDeliveriesQuerySchema = Joi.object({
  status: Joi.string()
    .valid(
      'pending',
      'in_progress',
      'processing',
      'delivered',
      'succeeded',
      'failed',
      'retry_scheduled',
      'exhausted',
      'dead_lettered'
    )
    .optional(),
  endpoint_id: Joi.string().uuid().optional(),
  limit: Joi.number().integer().min(1).max(100).default(50),
  offset: Joi.number().integer().min(0).default(0),
});

export const deliveryIdParamSchema = Joi.object({
  deliveryId: Joi.string().uuid().required().messages({
    'string.guid': 'deliveryId must be a valid UUID',
    'any.required': 'deliveryId is required',
  }),
});

export const replayDeliveryBodySchema = Joi.object({
  reason: Joi.string().max(500).default('Manual replay initiated'),
});
