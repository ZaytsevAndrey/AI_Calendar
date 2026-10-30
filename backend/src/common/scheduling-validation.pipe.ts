import {
  ArgumentMetadata,
  BadRequestException,
  Injectable,
  PipeTransform,
} from '@nestjs/common';
import { validate } from 'class-validator';

const PRIMITIVES: unknown[] = [String, Boolean, Number, Array, Object];

/**
 * Validates request bodies and query DTOs of the scheduling controllers
 * (tasks, phases, schedule) and keeps only the properties the DTO declares,
 * so a client can never set `id`, `userId` or sync columns (`googleEventId`,
 * …) through mass assignment. Invalid input is a 400.
 *
 * class-validator only (Nest's ValidationPipe needs class-transformer, which
 * this project does not install). No type coercion: values stay as sent.
 * Applied per controller, not globally: other modules' DTOs are not all
 * fully decorated.
 */
@Injectable()
export class SchedulingValidationPipe implements PipeTransform {
  async transform(value: unknown, { metatype, type }: ArgumentMetadata): Promise<unknown> {
    if (type !== 'body' && type !== 'query') return value;
    if (!metatype || PRIMITIVES.includes(metatype)) return value;
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new BadRequestException('Request body must be a JSON object');
    }
    const instance = Object.assign(Object.create(metatype.prototype), value);
    const errors = await validate(instance, { whitelist: true, forbidUnknownValues: false });
    if (errors.length) {
      throw new BadRequestException(
        errors.flatMap((error) => Object.values(error.constraints ?? { [error.property]: 'invalid' })),
      );
    }
    return { ...instance };
  }
}

export const schedulingValidationPipe = new SchedulingValidationPipe();

/** Never copied from a request body into an entity, even by internal callers. */
export function withoutIdentityKeys<T extends object>(body: T): T {
  const copy = { ...body } as Record<string, unknown>;
  for (const key of ['id', 'userId', 'createdAt', 'updatedAt']) delete copy[key];
  return copy as T;
}
