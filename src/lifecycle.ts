import type { PluginDefinition, PluginIdentity, PluginLifecycleContext } from "./types.js";

export interface PluginLifecycleLogger {
  warn(msg: string, meta?: Record<string, unknown>): void;
}

/** Runs onLoad, isolating any failure so it cannot crash the daemon (specs.md #17, Rule 6). */
export async function runOnLoad(
  identity: PluginIdentity,
  plugin: PluginDefinition,
  ctx: PluginLifecycleContext,
  logger?: PluginLifecycleLogger,
): Promise<void> {
  await run("onLoad", identity, () => plugin.onLoad?.(ctx), logger);
}

export async function runOnUnload(
  identity: PluginIdentity,
  plugin: PluginDefinition,
  ctx: PluginLifecycleContext,
  logger?: PluginLifecycleLogger,
): Promise<void> {
  await run("onUnload", identity, () => plugin.onUnload?.(ctx), logger);
}

async function run(
  hook: "onLoad" | "onUnload",
  identity: PluginIdentity,
  invoke: () => void | Promise<void>,
  logger?: PluginLifecycleLogger,
): Promise<void> {
  try {
    await invoke();
  } catch (err) {
    logger?.warn("plugin.hook_failed", {
      pluginId: identity.id,
      hook,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
