/**
 * Gemini's Genkit adapter only converts typed object/array/primitive properties.
 * MCP's strict draft-7 schemas may contain refs and unions, which that adapter
 * otherwise turns into undefined properties or array items. This projection is
 * for model guidance only; every invocation still passes the original MCP schema.
 */
type JsonSchema = Record<string, unknown>;
const GEMINI_MAX_MODEL_ENUM_VALUES = 50;

function objectValue(value: unknown): JsonSchema | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonSchema : null;
}

function typedAlternatives(schema: JsonSchema): JsonSchema[] | null {
  const alternatives = schema.anyOf ?? schema.oneOf;
  return Array.isArray(alternatives)
    ? alternatives.map(objectValue).filter((value): value is JsonSchema => value !== null)
    : null;
}

function resolveLocalRef(ref: string, root: JsonSchema): JsonSchema {
  if (!ref.startsWith('#/')) throw new Error('Unsupported Assistant tool schema reference.');
  let value: unknown = root;
  for (const escapedSegment of ref.slice(2).split('/')) {
    const segment = escapedSegment.replace(/~1/g, '/').replace(/~0/g, '~');
    value = objectValue(value)?.[segment];
  }
  const resolved = objectValue(value);
  if (!resolved) throw new Error('Unresolved Assistant tool schema reference.');
  return resolved;
}

function discriminatorLabel(schema: JsonSchema): string | null {
  const properties = objectValue(schema.properties);
  if (!properties) return null;
  const discriminator = (value: unknown): unknown => {
    const field = objectValue(value);
    return field?.const ?? (Array.isArray(field?.enum) && field.enum.length === 1 ? field.enum[0] : null);
  };
  const kind = discriminator(properties.kind);
  const mode = discriminator(properties.mode);
  if (typeof kind !== 'string') return null;
  return typeof mode === 'string' ? `${kind}/${mode}` : kind;
}

function unionSchemas(variants: JsonSchema[]): JsonSchema {
  const nonNull = variants.filter(variant => variant.type !== 'null');
  if (nonNull.length === 0) throw new Error('Assistant tool schema has no usable type.');
  const nullable = nonNull.length !== variants.length;
  if (nonNull.length === 1) {
    return { ...nonNull[0], ...(nullable ? { nullable: true } : {}) };
  }
  const types = new Set(nonNull.map(variant => variant.type));
  // Prefer the explicit list when a tool accepts a provider list or a special
  // "all" string. The public MCP contract still accepts both forms.
  if (types.size > 1) {
    const preferred = nonNull.find(variant => variant.type === 'array') ?? nonNull[0];
    return { ...preferred, ...(nullable ? { nullable: true } : {}) };
  }
  const type = nonNull[0].type;
  if (type === 'object') {
    const propertyNames = new Set(nonNull.flatMap(variant => Object.keys(objectValue(variant.properties) ?? {})));
    const properties: JsonSchema = {};
    const commonRequired = nonNull.reduce<string[]>((common, variant, index) => {
      const required = Array.isArray(variant.required)
        ? variant.required.filter((value): value is string => typeof value === 'string') : [];
      return index === 0 ? required : common.filter(value => required.includes(value));
    }, []);
    for (const name of propertyNames) {
      const present = nonNull.flatMap(variant => {
        const property = objectValue(objectValue(variant.properties)?.[name]);
        return property ? [{ variant, property }] : [];
      });
      const projected = unionSchemas(present.map(entry => entry.property));
      const condition = present.flatMap(({ variant }) => {
        const required = Array.isArray(variant.required) && variant.required.includes(name);
        const label = discriminatorLabel(variant);
        return required && label && !commonRequired.includes(name) ? [label] : [];
      });
      properties[name] = condition.length
        ? { ...projected, description: [projected.description,
          `Required for ${[...new Set(condition)].join(', ')}.`].filter(Boolean).join(' ') }
        : projected;
    }
    return { type: 'object', properties, ...(commonRequired.length ? { required: commonRequired } : {}),
      ...(nullable ? { nullable: true } : {}) };
  }
  if (type === 'array') {
    const items = nonNull.map(variant => objectValue(variant.items)).filter((value): value is JsonSchema => value !== null);
    if (items.length !== nonNull.length) throw new Error('Assistant tool array schema has no items.');
    return { type: 'array', items: unionSchemas(items), ...(nullable ? { nullable: true } : {}) };
  }
  const values = nonNull.flatMap(variant => Array.isArray(variant.enum)
    ? variant.enum : variant.const !== undefined ? [variant.const] : []);
  const allEnumerated = nonNull.every(variant => Array.isArray(variant.enum) || variant.const !== undefined);
  const enumerated = [...new Set(values)];
  return { type, ...(allEnumerated && enumerated.every(value => typeof value === 'string')
    && enumerated.length <= GEMINI_MAX_MODEL_ENUM_VALUES
    ? { enum: enumerated }
    : allEnumerated ? { description: enumerated.length > GEMINI_MAX_MODEL_ENUM_VALUES
      ? 'Use an exact supported catalog value; discover it before calling this tool.'
      : `Allowed value${enumerated.length === 1 ? '' : 's'}: ${enumerated.join(', ')}.` } : {}),
    ...(nullable ? { nullable: true } : {}) };
}

function project(schema: JsonSchema, root: JsonSchema, references: Set<string>): JsonSchema {
  if (typeof schema.$ref === 'string') {
    if (references.has(schema.$ref)) throw new Error('Recursive Assistant tool schema reference.');
    const projected = project(resolveLocalRef(schema.$ref, root), root, new Set([...references, schema.$ref]));
    return { ...projected, ...(typeof schema.description === 'string' ? { description: schema.description } : {}) };
  }
  if (Array.isArray(schema.allOf)) {
    const parts = schema.allOf.map(objectValue).filter((value): value is JsonSchema => value !== null)
      .map(part => project(part, root, references));
    if (parts.length !== schema.allOf.length || parts.length === 0) throw new Error('Invalid Assistant tool schema conjunction.');
    const merged = parts.reduce<JsonSchema>((acc, part) => ({ ...acc, ...part,
      ...(acc.type === 'object' && part.type === 'object' ? {
        properties: { ...objectValue(acc.properties), ...objectValue(part.properties) },
        required: [...new Set([...(Array.isArray(acc.required) ? acc.required : []),
          ...(Array.isArray(part.required) ? part.required : [])])],
      } : {}),
    }), {});
    return { ...merged, ...(typeof schema.description === 'string' ? { description: schema.description } : {}) };
  }
  // A typed parent may carry oneOf solely as a cross-field constraint. Its
  // named properties remain the model shape; MCP enforces that constraint.
  const alternatives = schema.type === undefined ? typedAlternatives(schema) : null;
  if (alternatives) {
    if (alternatives.length === 0) throw new Error('Assistant tool schema has no alternatives.');
    const merged = unionSchemas(alternatives.map(variant => project(variant, root, references)));
    return { ...merged, ...(typeof schema.description === 'string' ? { description: schema.description } : {}) };
  }
  const rawType = schema.type;
  if (Array.isArray(rawType)) {
    const types = rawType.filter((value): value is string => typeof value === 'string');
    if (types.length !== rawType.length || types.length === 0) throw new Error('Invalid Assistant tool schema type.');
    const projected = project({ ...schema, type: types.find(value => value !== 'null') ?? 'null' }, root, references);
    return { ...projected, ...(types.includes('null') ? { nullable: true } : {}) };
  }
  if (rawType === 'object') {
    const original = objectValue(schema.properties) ?? {};
    const properties: JsonSchema = {};
    for (const [name, value] of Object.entries(original)) {
      const child = objectValue(value);
      if (!child) throw new Error('Invalid Assistant tool object property.');
      properties[name] = project(child, root, references);
    }
    const required = Array.isArray(schema.required)
      ? schema.required.filter((name): name is string => typeof name === 'string' && name in properties)
      : [];
    return { type: 'object', properties, ...(required.length ? { required } : {}),
      ...(typeof schema.description === 'string' ? { description: schema.description } : {}),
      ...(schema.nullable === true ? { nullable: true } : {}) };
  }
  if (rawType === 'array') {
    const items = objectValue(schema.items);
    if (!items) throw new Error('Assistant tool array schema has no items.');
    return { type: 'array', items: project(items, root, references),
      ...(typeof schema.description === 'string' ? { description: schema.description } : {}),
      ...(schema.nullable === true ? { nullable: true } : {}) };
  }
  if (rawType === 'null') return { type: 'null' };
  if (!['string', 'number', 'integer', 'boolean'].includes(String(rawType))) {
    throw new Error('Assistant tool schema has an unsupported type.');
  }
  const enumerated = Array.isArray(schema.enum) ? schema.enum : schema.const !== undefined ? [schema.const] : [];
  const description = [typeof schema.description === 'string' ? schema.description : '',
    enumerated.length > GEMINI_MAX_MODEL_ENUM_VALUES
      ? 'Use an exact supported catalog value; discover it before calling this tool.'
      : enumerated.length > 0 && !enumerated.every(value => typeof value === 'string')
      ? `Allowed value${enumerated.length === 1 ? '' : 's'}: ${enumerated.join(', ')}.` : ''].filter(Boolean).join(' ');
  return { type: rawType,
    ...(description ? { description } : {}),
    ...(enumerated.length > 0 && enumerated.length <= GEMINI_MAX_MODEL_ENUM_VALUES
      && enumerated.every(value => typeof value === 'string') ? { enum: enumerated } : {}),
    ...(schema.nullable === true ? { nullable: true } : {}) };
}

export function projectGeminiToolInputSchema<T extends JsonSchema & { type: 'object' }>(schema: T): T {
  return project(schema, schema, new Set()) as T;
}
