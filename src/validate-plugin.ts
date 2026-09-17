import type { PluginDefinition, PluginIdentity } from "./types.js";

export class PluginValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PluginValidationError";
  }
}

/**
 * Plugin modules are untrusted input (specs.md Rule 5) — a plugin file could
 * be missing its default export, malformed, or hand-edited. Validate its
 * shape before ever calling into it.
 *
 * Identity is not checked here: it came from plugin.json before this module
 * was ever imported, and the definition has no business repeating it.
 */
export function validatePluginShape(
  identity: PluginIdentity,
  candidate: unknown,
): PluginDefinition {
  if (typeof candidate !== "object" || candidate === null) {
    throw new PluginValidationError("Plugin module has no valid default export.");
  }
  const definition = candidate as PluginDefinition;

  if (definition.actions) {
    if (typeof definition.actions !== "object") {
      throw new PluginValidationError(`Plugin "${identity.id}" has a non-object actions map.`);
    }
    for (const [key, action] of Object.entries(definition.actions)) {
      if (typeof action?.execute !== "function") {
        throw new PluginValidationError(
          `Plugin "${identity.id}" action "${key}" has no execute() function.`,
        );
      }
    }
  }

  if (definition.devices !== undefined) {
    if (!Array.isArray(definition.devices)) {
      throw new PluginValidationError(`Plugin "${identity.id}" has a non-array devices list.`);
    }
    for (const [index, driver] of definition.devices.entries()) {
      if (typeof driver?.driverId !== "string" || !driver.driverId) {
        throw new PluginValidationError(
          `Plugin "${identity.id}" device #${index} has no driverId.`,
        );
      }
      if (typeof driver.discover !== "function") {
        throw new PluginValidationError(
          `Plugin "${identity.id}" device "${driver.driverId}" has no discover() function.`,
        );
      }
    }
  }
  return definition;
}
