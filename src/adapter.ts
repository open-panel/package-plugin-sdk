import type { ActionDefinition } from "@open-panel/action-engine";
import type { PluginCapabilities, PluginDefinition, PluginIdentity } from "./types.js";
import { validatePluginConfig } from "./config-schema.js";

/**
 * Turns every action a plugin exposes into a regular action-engine
 * ActionDefinition, namespaced as "<pluginId>.<actionKey>" so plugin actions
 * can never collide with built-ins or with each other (specs.md #14, #16).
 *
 * A plugin action throwing is caught here and re-thrown with a user-facing
 * message ("Plugin \"X\" failed to execute an action.", specs.md #21); the
 * action engine's own catch-all still guarantees the daemon never crashes.
 */
export function toActionDefinitions(
  identity: PluginIdentity,
  plugin: PluginDefinition,
  capabilities: PluginCapabilities,
): ActionDefinition<Record<string, unknown>>[] {
  if (!plugin.actions) return [];

  return Object.entries(plugin.actions).map(([key, action]) => ({
    type: `${identity.id}.${key}`,
    name: `${identity.name}: ${action.name}`,
    description: action.description,
    async execute(ctx, config) {
      const validatedConfig = validatePluginConfig(action.name, action.configSchema, config);
      try {
        await action.execute({
          ...capabilities,
          log: ctx.log,
          shell: ctx.shell,
          executionId: ctx.executionId,
          config: validatedConfig,
        });
      } catch (err) {
        const cause = err instanceof Error ? err.message : String(err);
        throw new Error(`Plugin "${identity.name}" failed to execute an action: ${cause}`, {
          cause: err,
        });
      }
    },
  }));
}
