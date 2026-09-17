import type { PluginDefinition } from "./types.js";

/**
 * Identity helper that gives plugin authors type-checking and IDE completion,
 * mirroring the ergonomics shown in specs.md #16.
 */
export function definePlugin(definition: PluginDefinition): PluginDefinition {
  return definition;
}
