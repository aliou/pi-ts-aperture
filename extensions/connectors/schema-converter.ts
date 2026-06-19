/**
 * Convert JSON Schema Draft-07 to TypeBox 1.x runtime types.
 *
 * This is a best-effort converter for MCP tool input schemas.
 * Unsupported or deeply nested structures fall back to Type.Unknown().
 */

import type { TSchema } from "typebox";
import { Type } from "typebox";

interface JsonSchema {
  type?: string;
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: (string | number | boolean)[];
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  allOf?: JsonSchema[];
  format?: string;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  default?: unknown;
  additionalProperties?: boolean | JsonSchema;
  [key: string]: unknown;
}

function convertSchema(schema: JsonSchema | undefined, depth: number): TSchema {
  if (depth > 10) {
    return Type.Unknown();
  }

  if (!schema || typeof schema !== "object") {
    return Type.Unknown();
  }

  const opts: Record<string, unknown> = {};
  if (schema.description) opts.description = schema.description;
  if (schema.default !== undefined) opts.default = schema.default;

  const type = schema.type;

  if (schema.enum && Array.isArray(schema.enum) && schema.enum.length > 0) {
    const literals = schema.enum.map((v) => {
      if (typeof v === "string") return Type.Literal(v);
      if (typeof v === "number") return Type.Literal(v);
      if (typeof v === "boolean") return Type.Literal(v);
      return Type.Unknown();
    });
    if (literals.length === 1) {
      return literals[0];
    }

    return Type.Union(literals, opts);
  }

  switch (type) {
    case "string": {
      const strOpts: Record<string, unknown> = { ...opts };
      if (schema.format) strOpts.format = schema.format;
      if (schema.minLength !== undefined) strOpts.minLength = schema.minLength;
      if (schema.maxLength !== undefined) strOpts.maxLength = schema.maxLength;
      return Type.String(strOpts);
    }
    case "number":
    case "integer": {
      const numOpts: Record<string, unknown> = { ...opts };
      if (schema.minimum !== undefined) numOpts.minimum = schema.minimum;
      if (schema.maximum !== undefined) numOpts.maximum = schema.maximum;
      return Type.Number(numOpts);
    }
    case "boolean":
      return Type.Boolean(opts);
    case "array": {
      const itemSchema = schema.items
        ? convertSchema(schema.items, depth + 1)
        : Type.Unknown();
      return Type.Array(itemSchema, opts);
    }
    case "object": {
      const props: Record<string, TSchema> = {};
      const required = new Set(schema.required ?? []);
      if (schema.properties) {
        for (const [key, propSchema] of Object.entries(schema.properties)) {
          const converted = convertSchema(propSchema, depth + 1);
          props[key] = required.has(key) ? converted : Type.Optional(converted);
        }
      }
      return Type.Object(props, opts);
    }
    default: {
      if (
        schema.anyOf &&
        Array.isArray(schema.anyOf) &&
        schema.anyOf.length > 0
      ) {
        const variants = schema.anyOf.map((s) =>
          convertSchema(s as JsonSchema, depth + 1),
        );
        if (variants.length === 1) return variants[0];

        return Type.Union(variants, opts);
      }
      if (
        schema.oneOf &&
        Array.isArray(schema.oneOf) &&
        schema.oneOf.length > 0
      ) {
        const variants = schema.oneOf.map((s) =>
          convertSchema(s as JsonSchema, depth + 1),
        );
        if (variants.length === 1) return variants[0];

        return Type.Union(variants, opts);
      }
      return Type.Unknown(opts);
    }
  }
}

export function jsonSchemaToTypeBox(schema: unknown): TSchema {
  return convertSchema(schema as JsonSchema, 0);
}
