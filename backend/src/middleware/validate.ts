import { Request, Response, NextFunction } from 'express';
import Joi from 'joi';
import { ValidationError } from '../shared/errors.js';

export function validate(
  schema: Joi.ObjectSchema,
  target: 'body' | 'query' | 'params' = 'body'
) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const options: Joi.ValidationOptions = {
      abortEarly: false,
      convert: target !== 'body',
      allowUnknown: false,
    };

    const { error, value } = schema.validate(req[target], options);

    if (error) {
      const details = error.details.map((d) => ({
        field: d.path.join('.'),
        message: d.message,
      }));
      return next(new ValidationError('Validation failed', details));
    }

    req[target] = value;
    next();
  };
}
