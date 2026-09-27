/**
 * JSON Schema (draft-07 subset) for the Makers → WordPress data contract (plan §4).
 *
 * `BRIEF_SCHEMA` is the single source of truth at runtime; `schema.json` at the repo root
 * is a byte-for-byte mirror for external consumers (the CN-server sync tool) and the unit
 * test asserts the two stay identical.
 *
 * `validateAgainstSchema` implements just the keywords used here so we do not pull in ajv.
 */

export const TOPIC_ENUM = ['设备', '材料', '供应链', '政策标准', '展会', '厂商动态'] as const;

export const BRIEF_SCHEMA = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: 'https://github.com/luxdsan/neotel-industry-trends/schema.json',
  title: 'Neotel industry trend brief',
  description: 'Structured output of one /trends/run (daily) or /trends/weekly run. Consumed read-only by the CN-server result sync tool.',
  type: 'object',
  additionalProperties: false,
  required: ['runId', 'generatedAt', 'status', 'window', 'items', 'report'],
  properties: {
    runId: { type: 'string', minLength: 1, maxLength: 128 },
    generatedAt: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d+)?(Z|[+-]\\d{2}:\\d{2})$' },
    status: { type: 'string', enum: ['completed', 'failed', 'empty'] },
    window: {
      type: 'object',
      additionalProperties: false,
      required: ['from', 'to'],
      properties: {
        from: { type: 'string', minLength: 10 },
        to: { type: 'string', minLength: 10 },
      },
    },
    items: {
      type: 'array',
      maxItems: 100,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'title', 'url', 'source', 'eventTime', 'fetchedAt', 'summaryZh', 'topic', 'score', 'seenCount'],
        properties: {
          id: { type: 'string', pattern: '^[0-9a-f]{40}$', description: 'sha1(canonical_url)' },
          title: { type: 'string', minLength: 1, maxLength: 300 },
          url: { type: 'string', pattern: '^https?://' },
          source: { type: 'string', minLength: 1, maxLength: 120 },
          eventTime: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}' },
          fetchedAt: { type: 'string', minLength: 10 },
          summaryZh: { type: 'string', maxLength: 80, description: '≤80 字事实摘要（code points）' },
          topic: { type: 'string', enum: [...TOPIC_ENUM] },
          score: { type: 'integer', minimum: 0, maximum: 100 },
          seenCount: { type: 'integer', minimum: 1 },
        },
      },
    },
    report: {
      type: 'object',
      additionalProperties: false,
      required: ['titleZh', 'highlights', 'topics', 'neotelNote', 'markdown'],
      properties: {
        titleZh: { type: 'string', minLength: 1, maxLength: 120 },
        highlights: {
          type: 'array',
          maxItems: 8,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['text', 'itemIds'],
            properties: {
              text: { type: 'string', minLength: 1, maxLength: 160 },
              itemIds: { type: 'array', minItems: 1, items: { type: 'string', pattern: '^[0-9a-f]{40}$' } },
            },
          },
        },
        topics: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['name', 'count'],
            properties: {
              name: { type: 'string', enum: [...TOPIC_ENUM] },
              count: { type: 'integer', minimum: 1 },
            },
          },
        },
        neotelNote: { type: 'string', maxLength: 300, description: '挚锦解读；无物料管理关联时为空字符串' },
        markdown: { type: 'string' },
      },
    },
  },
} as const;

// ── Minimal validator ─────────────────────────────────────────────────────────

type Schema = Record<string, any>;

export interface SchemaError { path: string; message: string }

function typeOf(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

export function validateAgainstSchema(value: unknown, schema: Schema, path = '$'): SchemaError[] {
  const errors: SchemaError[] = [];
  const push = (message: string) => errors.push({ path, message });

  if (schema.type) {
    const t = typeOf(value);
    const ok = schema.type === 'integer'
      ? t === 'number' && Number.isInteger(value)
      : schema.type === 'number' ? t === 'number' : t === schema.type;
    if (!ok) { push(`expected ${schema.type}, got ${t}`); return errors; }
  }
  if (schema.enum && !schema.enum.includes(value)) push(`value ${JSON.stringify(value)} not in enum`);

  if (typeof value === 'string') {
    if (schema.minLength != null && Array.from(value).length < schema.minLength) push(`shorter than minLength ${schema.minLength}`);
    if (schema.maxLength != null && Array.from(value).length > schema.maxLength) push(`longer than maxLength ${schema.maxLength}`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) push(`does not match pattern ${schema.pattern}`);
  }
  if (typeof value === 'number') {
    if (schema.minimum != null && value < schema.minimum) push(`below minimum ${schema.minimum}`);
    if (schema.maximum != null && value > schema.maximum) push(`above maximum ${schema.maximum}`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems != null && value.length < schema.minItems) push(`fewer than minItems ${schema.minItems}`);
    if (schema.maxItems != null && value.length > schema.maxItems) push(`more than maxItems ${schema.maxItems}`);
    if (schema.items) value.forEach((v, i) => errors.push(...validateAgainstSchema(v, schema.items, `${path}[${i}]`)));
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    for (const key of schema.required || []) {
      if (!(key in obj)) errors.push({ path: `${path}.${key}`, message: 'required property missing' });
    }
    const props: Record<string, Schema> = schema.properties || {};
    for (const [key, sub] of Object.entries(props)) {
      if (key in obj) errors.push(...validateAgainstSchema(obj[key], sub, `${path}.${key}`));
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(obj)) {
        if (!(key in props)) errors.push({ path: `${path}.${key}`, message: 'additional property not allowed' });
      }
    }
  }
  return errors;
}
