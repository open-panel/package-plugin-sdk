import { describe, expect, it, vi } from "vitest";
import { toActionDefinitions } from "./adapter.js";
import { createDefaultCapabilities } from "./default-capabilities.js";
import type { PluginDefinition } from "./types.js";

function baseCtx() {
  return {
    executionId: "exec-1",
    log: vi.fn(),
    shell: vi.fn().mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 }),
  };
}

/** Identity comes from plugin.json, so a test supplies it the same way. */
const DOCKER = { id: "docker", name: "Docker" };

describe("toActionDefinitions", () => {
  it("namespaces plugin actions as <pluginId>.<actionKey>", () => {
    const plugin: PluginDefinition = {
      actions: {
        restartContainer: {
          name: "Restart Container",
          configSchema: { container: { type: "string", required: true } },
          async execute() {},
        },
      },
    };
    const [definition] = toActionDefinitions(DOCKER, plugin, createDefaultCapabilities());
    expect(definition!.type).toBe("docker.restartContainer");
  });

  it("exposes ctx.config to the plugin action, matching specs.md #16", async () => {
    let seenConfig: unknown;
    const plugin: PluginDefinition = {
      actions: {
        restartContainer: {
          name: "Restart Container",
          configSchema: { container: { type: "string", required: true } },
          async execute(ctx) {
            seenConfig = ctx.config;
          },
        },
      },
    };
    const [definition] = toActionDefinitions(DOCKER, plugin, createDefaultCapabilities());
    await definition!.execute(baseCtx() as any, { container: "web" });
    expect(seenConfig).toEqual({ container: "web" });
  });

  it("isolates a throwing plugin action with a user-facing message, never letting it escape raw", async () => {
    const plugin: PluginDefinition = {
      actions: {
        explode: {
          name: "Explode",
          async execute() {
            throw new Error("boom");
          },
        },
      },
    };
    const [definition] = toActionDefinitions(
      { id: "flaky", name: "Flaky" },
      plugin,
      createDefaultCapabilities(),
    );
    await expect(definition!.execute(baseCtx() as any, {})).rejects.toThrow(
      /Plugin "Flaky" failed/,
    );
  });
});
