import type { LogLevel } from "@open-panel/shared";
import type { ShellResult } from "@open-panel/action-engine";
import type { DeviceDriver } from "@open-panel/device-sdk";

/**
 * Plugin code never touches application internals directly — everything it can
 * do is exposed through this controlled SDK (specs.md #17):
 *   ctx.log() ctx.shell() ctx.http() ctx.storage() ctx.notify() ctx.device()
 */
export interface PluginDeviceAccess {
  list(): { id: string; state: string }[];
  setButtonImage(deviceId: string, position: number, image: Buffer): Promise<void>;
  setButtonLabel(deviceId: string, position: number, label: string): Promise<void>;
}

export interface PluginStorage {
  get<T = unknown>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface PluginCapabilities {
  http: typeof fetch;
  storage: PluginStorage;
  notify(title: string, message: string): Promise<void>;
  device: PluginDeviceAccess;
}

export interface PluginLifecycleContext extends PluginCapabilities {
  log(level: LogLevel, message: string, meta?: Record<string, unknown>): void;
  shell(command: string): Promise<ShellResult>;
}

export type PluginActionContext<TConfig = Record<string, unknown>> = PluginLifecycleContext & {
  executionId: string;
  config: TConfig;
};

export interface SimpleConfigFieldSchema {
  type: "string" | "number" | "boolean";
  required?: boolean;
  default?: unknown;
}
/** The lightweight config schema format shown in specs.md #16 (plain objects, not zod). */
export type SimpleConfigSchema = Record<string, SimpleConfigFieldSchema>;

export interface PluginActionDefinition<TConfig = Record<string, unknown>> {
  name: string;
  description?: string;
  configSchema?: SimpleConfigSchema;
  execute(ctx: PluginActionContext<TConfig>): Promise<void>;
}

/**
 * The code half of a plugin: what it does, never who it is. Identity —
 * id, name, version, author — lives in plugin.json, so there is exactly one
 * place to read it and no way for the two halves to disagree.
 */
export interface PluginDefinition {
  // `any`: each action in the map has its own, unrelated config shape —
  // same rationale as @open-panel/action-engine's ActionRegistry (Rule 4).
  actions?: Record<string, PluginActionDefinition<any>>;
  /**
   * Hardware this plugin can talk to. A driver is constructed by the plugin
   * itself and handed over as-is: everything the daemon does with a device
   * goes through `DeviceDriver`/`DeckDevice` (specs.md #9), so a plugin
   * contributing one needs no other privilege. Anything a driver wants to set
   * up asynchronously belongs in `onLoad`.
   */
  devices?: DeviceDriver[];
  onLoad?(ctx: PluginLifecycleContext): void | Promise<void>;
  onUnload?(ctx: PluginLifecycleContext): void | Promise<void>;
}

/**
 * The identity a loaded plugin is addressed by. Taken from the manifest and
 * passed to everything that needs to name the plugin — action namespacing,
 * log lines, error messages the user reads.
 */
export interface PluginIdentity {
  id: string;
  name: string;
}
