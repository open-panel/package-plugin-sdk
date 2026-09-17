import { z } from "zod";
import type { SimpleConfigSchema } from "./types.js";

export class PluginConfigError extends Error {
  constructor(pluginActionName: string, issues: string[]) {
    super(`Invalid configuration for "${pluginActionName}": ${issues.join("; ")}`);
    this.name = "PluginConfigError";
  }
}

const FIELD_TYPES: Record<SimpleConfigSchema[string]["type"], z.ZodTypeAny> = {
  string: z.string(),
  number: z.number(),
  boolean: z.boolean(),
};

/** Converts the plain-object schema from specs.md #16 into a zod schema for validation. */
export function toZodSchema(schema: SimpleConfigSchema): z.ZodTypeAny {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [key, field] of Object.entries(schema)) {
    let fieldSchema = FIELD_TYPES[field.type];
    if (field.default !== undefined) fieldSchema = fieldSchema.default(field.default);
    else if (!field.required) fieldSchema = fieldSchema.optional();
    shape[key] = fieldSchema;
  }
  return z.object(shape);
}

/** Plugin action config is an untrusted boundary just like built-in actions (specs.md Rule 5). */
export function validatePluginConfig(
  actionName: string,
  schema: SimpleConfigSchema | undefined,
  input: unknown,
): Record<string, unknown> {
  if (!schema) return (input as Record<string, unknown>) ?? {};
  const result = toZodSchema(schema).safeParse(input ?? {});
  if (!result.success) {
    throw new PluginConfigError(
      actionName,
      result.error.issues.map((i) => `${i.path.join(".")} ${i.message}`),
    );
  }
  return result.data as Record<string, unknown>;
}
