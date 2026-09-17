import type { PluginCapabilities, PluginDeviceAccess, PluginStorage } from "./types.js";
import { showNotification } from "./platform/notify.js";

/** Ephemeral, per-process storage — fine for tests/dev; the daemon supplies a persistent, SQLite-backed one. */
class InMemoryPluginStorage implements PluginStorage {
  private readonly data = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | undefined> {
    return this.data.get(key) as T | undefined;
  }
  async set(key: string, value: unknown): Promise<void> {
    this.data.set(key, value);
  }
  async delete(key: string): Promise<void> {
    this.data.delete(key);
  }
}

const noopDeviceAccess: PluginDeviceAccess = {
  list: () => [],
  async setButtonImage() {
    throw new Error("Device access is not available outside the daemon runtime.");
  },
  async setButtonLabel() {
    throw new Error("Device access is not available outside the daemon runtime.");
  },
};

/**
 * Standalone capabilities used by tests and by tooling that loads plugins
 * outside the daemon. The daemon overrides `storage` and `device` with real,
 * persistent implementations when running plugins for real (specs.md #17).
 */
export function createDefaultCapabilities(): PluginCapabilities {
  return {
    http: fetch,
    storage: new InMemoryPluginStorage(),
    notify: showNotification,
    device: noopDeviceAccess,
  };
}
