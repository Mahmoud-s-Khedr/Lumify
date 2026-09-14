import type { ZodTypeAny } from 'zod';

type JsonSchema = Record<string, unknown>;
type ZodDefinition = Record<string, unknown>;
type Check = {
  kind: string;
  value?: number;
  inclusive?: boolean;
  regex?: RegExp;
};

/**
 * Converts the Zod v3 DTOs used by the application into the JSON Schema subset
 * understood by Fastify and @fastify/swagger. Keeping this next to the request
 * validation schemas makes the generated OpenAPI document the source of truth.
 */
export function zodSchema(schema: ZodTypeAny): JsonSchema {
  return toJsonSchema(schema);
}

/**
 * Fastify uses the generated schema for validation as well as documentation.
 * Zod accepts and strips unknown object keys, whereas Swagger UI renders an
 * `additionalProp1` example for open objects. This documentation-only pass
 * closes generated Zod objects after Fastify has registered the route, without
 * changing the existing request parsing behavior.
 */
export function closeZodObjectsForDocumentation<T>(value: T): T {
  if (Array.isArray(value)) return value.map(closeZodObjectsForDocumentation) as T;
  if (value === null || typeof value !== 'object') return value;

  const record = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(record)) {
    result[key] = closeZodObjectsForDocumentation(child);
  }
  if (record.additionalProperties === true) result.additionalProperties = false;
  return result as T;
}

function toJsonSchema(schema: ZodTypeAny): JsonSchema {
  const definition = schema._def as ZodDefinition;

  switch (definition.typeName) {
    case 'ZodObject': {
      const shapeDefinition = definition.shape as
        Record<string, ZodTypeAny> | (() => Record<string, ZodTypeAny>);
      const shape = typeof shapeDefinition === 'function' ? shapeDefinition() : shapeDefinition;
      const properties: Record<string, JsonSchema> = {};
      const required: string[] = [];
      for (const [key, value] of Object.entries(shape)) {
        properties[key] = toJsonSchema(value);
        if (!isOptional(value)) required.push(key);
      }
      return {
        type: 'object',
        properties,
        ...(required.length > 0 ? { required } : {}),
        // Zod strips unknown object keys by default. Allowing them here preserves
        // the existing runtime behavior while still documenting known DTO fields.
        additionalProperties: true,
      };
    }
    case 'ZodString':
      return stringSchema(definition);
    case 'ZodNumber':
      return numberSchema(definition);
    case 'ZodBoolean':
      return { type: 'boolean' };
    case 'ZodNull':
      return { type: 'null' };
    case 'ZodArray':
      return {
        type: 'array',
        items: toJsonSchema(definition.type as ZodTypeAny),
        ...arrayConstraints(definition),
      };
    case 'ZodEnum':
      return { type: 'string', enum: definition.values as string[] };
    case 'ZodLiteral':
      return { const: definition.value };
    case 'ZodUnion':
      return { anyOf: (definition.options as ZodTypeAny[]).map(toJsonSchema) };
    case 'ZodDiscriminatedUnion':
      return {
        oneOf: [...(definition.options as Map<unknown, ZodTypeAny>).values()].map(toJsonSchema),
      };
    case 'ZodOptional':
      return toJsonSchema(definition.innerType as ZodTypeAny);
    case 'ZodNullable':
      return { ...toJsonSchema(definition.innerType as ZodTypeAny), nullable: true };
    case 'ZodDefault':
      return {
        ...toJsonSchema(definition.innerType as ZodTypeAny),
        default: (definition.defaultValue as () => unknown)(),
      };
    case 'ZodEffects': {
      const innerSchema = toJsonSchema(definition.schema as ZodTypeAny);
      // All object-level effects in the request DTOs enforce an additional
      // invariant. A non-empty PATCH body is the common case; `minProperties`
      // makes that constraint visible to generated clients and Swagger UI.
      if (innerSchema.type === 'object') return { ...innerSchema, minProperties: 1 };
      return innerSchema;
    }
    case 'ZodRecord':
      return {
        type: 'object',
        additionalProperties: toJsonSchema(definition.valueType as ZodTypeAny),
      };
    default:
      return {};
  }
}

function isOptional(schema: ZodTypeAny): boolean {
  const definition = schema._def as ZodDefinition;
  return definition.typeName === 'ZodOptional' || definition.typeName === 'ZodDefault';
}

function stringSchema(definition: ZodDefinition): JsonSchema {
  const result: JsonSchema = { type: 'string' };
  for (const check of definition.checks as Check[]) {
    if (check.kind === 'min') result.minLength = check.value;
    if (check.kind === 'max') result.maxLength = check.value;
    if (check.kind === 'regex' && check.regex) {
      result.pattern = check.regex.source;
      if (check.regex.source === '^\\d{4}-\\d{2}-\\d{2}$') result.format = 'date';
    }
    if (check.kind === 'email') result.format = 'email';
    if (check.kind === 'url') result.format = 'uri';
    if (check.kind === 'datetime') result.format = 'date-time';
  }
  return result;
}

function numberSchema(definition: ZodDefinition): JsonSchema {
  const result: JsonSchema = { type: 'number' };
  for (const check of definition.checks as Check[]) {
    if (check.kind === 'int') result.type = 'integer';
    if (check.kind === 'min')
      result[check.inclusive ? 'minimum' : 'exclusiveMinimum'] = check.value;
    if (check.kind === 'max')
      result[check.inclusive ? 'maximum' : 'exclusiveMaximum'] = check.value;
  }
  return result;
}

function arrayConstraints(definition: ZodDefinition): JsonSchema {
  const result: JsonSchema = {};
  const minLength = definition.minLength as { value: number } | null;
  const maxLength = definition.maxLength as { value: number } | null;
  if (minLength) result.minItems = minLength.value;
  if (maxLength) result.maxItems = maxLength.value;
  return result;
}
