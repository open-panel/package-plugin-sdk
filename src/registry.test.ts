import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { PluginRegistry } from "./registry.js";

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "__fixtures__");

function collect() {
  const lines: { level: "warn" | "info"; msg: string; meta?: Record<string, unknown> }[] = [];
  return {
    lines,
    logger: {
      warn: (msg: string, meta?: Record<string, unknown>) =>
        lines.push({ level: "warn", msg, meta }),
      info: (msg: string, meta?: Record<string, unknown>) =>
        lines.push({ level: "info", msg, meta }),
    },
  };
}

const registries: PluginRegistry[] = [];
const tempDirs: string[] = [];

function makeRegistry(directories: string[], logger?: ReturnType<typeof collect>["logger"]) {
  const registry = new PluginRegistry(directories, { logger });
  registries.push(registry);
  return registry;
}

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "openpanel-plugins-"));
  tempDirs.push(dir);
  return dir;
}

const THEME = {
  id: "dracula",
  name: "Dracula",
  appearance: "dark",
  palette: {
    background: "#282a36",
    surface: "#44475a",
    foreground: "#f8f8f2",
    dim: "#6272a4",
    accent: "#bd93f9",
    success: "#50fa7b",
    warning: "#ffb86c",
    danger: "#ff5555",
  },
};

/** Writes a theme-contributing plugin, which is the smallest plugin there is. */
async function writeThemePlugin(
  root: string,
  id: string,
  overrides: { name?: string; version?: string; theme?: Record<string, unknown> } = {},
): Promise<string> {
  const directory = path.join(root, id);
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, "plugin.json"),
    JSON.stringify({
      manifestVersion: 1,
      id,
      name: overrides.name ?? id,
      version: overrides.version ?? "1.0.0",
      contributes: { themes: ["./theme.json"] },
    }),
  );
  await writeFile(
    path.join(directory, "theme.json"),
    JSON.stringify({ ...THEME, ...overrides.theme }),
  );
  return directory;
}

afterEach(async () => {
  for (const registry of registries.splice(0)) registry.close();
  for (const dir of tempDirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

describe("PluginRegistry", () => {
  it("loads a code plugin, taking its identity from the manifest", async () => {
    const registry = makeRegistry([fixturesDir]);
    await registry.load();

    const plugin = registry.get("sample");
    expect(plugin?.manifest.name).toBe("Sample");
    expect(plugin?.contributions.actions?.definition.actions?.ping).toBeDefined();
  });

  it("loads a data plugin without importing anything", async () => {
    const registry = makeRegistry([fixturesDir]);
    await registry.load();

    const plugin = registry.get("theme-pack")!;
    expect(plugin.contributions.actions).toBeUndefined();
    expect(plugin.manifest.author).toBe("Someone");
  });

  it("loads a locale contribution as data, like a theme", async () => {
    const registry = makeRegistry([fixturesDir]);
    await registry.load();

    const plugin = registry.get("locale-pack")!;
    expect(plugin.contributions.actions).toBeUndefined();
    expect(plugin.contributions.locales.map((locale) => locale.id)).toEqual(["pt-PT"]);
    expect(plugin.contributions.locales[0]!.messages["common.save"]).toBe("Guardar");
    // The pack's second catalogue is malformed; the first still loaded.
    expect(plugin.problems[0]).toContain("broken.json");
  });

  it("loads device drivers as a contribution like any other", async () => {
    const registry = makeRegistry([fixturesDir]);
    await registry.load();

    const plugin = registry.get("device-pack")!;
    expect(plugin.contributions.devices?.drivers.map((d) => d.driverId)).toEqual(["pretend"]);
    expect(plugin.problems).toEqual([]);
  });

  it("imports one module once when a plugin points two code kinds at it", async () => {
    const registry = makeRegistry([fixturesDir]);
    await registry.load();

    const plugin = registry.get("device-pack")!;
    expect(plugin.contributions.actions?.definition.actions?.ping).toBeDefined();
    // Both halves come off the same object, so onLoad runs once, not per kind.
    expect(plugin.modules).toHaveLength(1);
    expect(plugin.modules[0]).toBe(plugin.contributions.actions?.definition);
  });

  it("names a devices contribution that exports no driver instead of loading nothing", async () => {
    const { lines, logger } = collect();
    const registry = makeRegistry([fixturesDir], logger);
    await registry.load();

    const plugin = registry.get("empty-device-pack")!;
    expect(plugin.contributions.devices).toBeUndefined();
    expect(plugin.problems[0]).toContain("exports none");
    expect(
      lines.some(
        (line) => line.msg === "plugin.contribution_rejected" && line.meta?.kind === "devices",
      ),
    ).toBe(true);
  });

  it("names an actions contribution that exposes no action instead of loading nothing", async () => {
    const { lines, logger } = collect();
    const registry = makeRegistry([fixturesDir], logger);
    await registry.load();

    // The failure this catches is not hypothetical: a bundled plugin read as
    // CommonJS arrives as an object with neither contribution on it, which
    // validates perfectly. Without this it installed, listed clean, and
    // registered nothing.
    const plugin = registry.get("empty-action-pack")!;
    expect(plugin.contributions.actions).toBeUndefined();
    expect(plugin.problems[0]).toContain("exposes none");
    expect(
      lines.some(
        (line) => line.msg === "plugin.contribution_rejected" && line.meta?.kind === "actions",
      ),
    ).toBe(true);
  });

  it("never imports a data plugin, so it has no modules at all", async () => {
    const registry = makeRegistry([fixturesDir]);
    await registry.load();

    expect(registry.get("theme-pack")!.modules).toEqual([]);
  });

  it("isolates one bad contribution instead of the whole plugin", async () => {
    // theme-pack ships two themes; only the second is malformed.
    const registry = makeRegistry([fixturesDir]);
    await registry.load();

    const plugin = registry.get("theme-pack")!;
    expect(plugin.contributions.themes.map((theme) => theme.id)).toEqual(["packed"]);
    expect(plugin.problems).toHaveLength(1);
    expect(plugin.problems[0]).toContain("bad.json");
  });

  it("skips a malformed code plugin without throwing, and still lists it", async () => {
    const registry = makeRegistry([fixturesDir]);
    await registry.load();

    const plugin = registry.get("broken")!;
    expect(plugin.contributions.actions).toBeUndefined();
    expect(plugin.problems[0]).toMatch(/no valid default export/);
  });

  it("warns about a directory with no manifest rather than guessing", async () => {
    const { lines, logger } = collect();
    await makeRegistry([fixturesDir], logger).load();

    const warning = lines.find((line) => line.msg === "plugin.manifest_missing");
    expect(warning?.meta?.expected).toBe("plugin.json");
  });

  it("ignores a loose file: a plugin is a directory with a manifest, nothing else", async () => {
    const dir = await makeTempDir();
    await writeFile(path.join(dir, "dracula.json"), JSON.stringify(THEME));

    const registry = makeRegistry([dir]);
    await registry.load();

    expect(registry.list()).toEqual([]);
  });

  it("skips a nonexistent directory without throwing", async () => {
    const registry = makeRegistry([path.join(fixturesDir, "does-not-exist")]);
    await expect(registry.load()).resolves.toEqual({ fresh: [], gone: [] });
  });

  it("refuses a plugin built against a different API major", async () => {
    const dir = await makeTempDir();
    const pluginDir = path.join(dir, "future");
    await mkdir(pluginDir, { recursive: true });
    await writeFile(
      path.join(pluginDir, "plugin.json"),
      JSON.stringify({
        manifestVersion: 1,
        id: "future",
        name: "From The Future",
        version: "1.0.0",
        apiVersion: "^2",
      }),
    );

    const { lines, logger } = collect();
    await makeRegistry([dir], logger).load();

    const warning = lines.find((line) => line.msg === "plugin.api_version_unsupported");
    expect(warning?.meta?.requires).toBe("^2");
  });

  it("rejects a contribution path that tries to escape the plugin directory", async () => {
    const dir = await makeTempDir();
    const pluginDir = path.join(dir, "nosy");
    await mkdir(pluginDir, { recursive: true });
    await writeFile(
      path.join(pluginDir, "plugin.json"),
      JSON.stringify({
        manifestVersion: 1,
        id: "nosy",
        name: "Nosy",
        version: "1.0.0",
        contributes: { themes: ["../../../etc/passwd"] },
      }),
    );

    const { lines, logger } = collect();
    const registry = makeRegistry([dir], logger);
    await registry.load();

    expect(registry.get("nosy")).toBeUndefined();
    expect(lines.some((line) => line.msg === "plugin.manifest_invalid")).toBe(true);
  });

  it("keeps a contribution kind it does not know from costing the plugin its others", async () => {
    const dir = await makeTempDir();
    const pluginDir = path.join(dir, "ahead");
    await mkdir(pluginDir, { recursive: true });
    await writeFile(
      path.join(pluginDir, "plugin.json"),
      JSON.stringify({
        manifestVersion: 1,
        id: "ahead",
        name: "Ahead",
        version: "1.0.0",
        contributes: { themes: ["./theme.json"], holograms: ["./x.holo"] },
      }),
    );
    await writeFile(path.join(pluginDir, "theme.json"), JSON.stringify(THEME));

    const registry = makeRegistry([dir]);
    await registry.load();

    const plugin = registry.get("ahead")!;
    expect(plugin.contributions.themes).toHaveLength(1);
    expect(plugin.problems[0]).toContain("holograms");
  });

  it("stops listing a plugin whose directory was deleted", async () => {
    const dir = await makeTempDir();
    const pluginDir = await writeThemePlugin(dir, "dracula");

    const registry = makeRegistry([dir]);
    await registry.load();
    expect(registry.get("dracula")).toBeDefined();

    await rm(pluginDir, { recursive: true, force: true });
    await registry.load();
    expect(registry.get("dracula")).toBeUndefined();
  });

  it("returns only newly loaded plugins, so a rescan never re-activates code", async () => {
    const dir = await makeTempDir();
    await writeThemePlugin(dir, "dracula");

    const registry = makeRegistry([dir]);
    expect((await registry.load()).fresh).toHaveLength(1);
    expect((await registry.load()).fresh).toHaveLength(0);
  });

  it("lets a later directory shadow an earlier one, so a user drop-in wins", async () => {
    const bundled = await makeTempDir();
    const user = await makeTempDir();
    await writeThemePlugin(bundled, "dracula", { name: "Dracula" });
    await writeThemePlugin(user, "dracula", { name: "Dracula (mine)" });

    const { lines, logger } = collect();
    const registry = makeRegistry([bundled, user], logger);
    await registry.load();

    expect(registry.get("dracula")!.manifest.name).toBe("Dracula (mine)");
    expect(lines.some((line) => line.msg === "plugin.shadowed")).toBe(true);
  });
});
