import { readFile, readdir, stat } from "node:fs/promises";
import { watch, type FSWatcher } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  LocaleCatalogSchema,
  ThemeManifestSchema,
  type LocaleCatalog,
  type ThemeManifest,
} from "@open-panel/shared";
import {
  declaredKinds,
  isApiVersionSupported,
  PLUGIN_API_VERSION,
  PLUGIN_MANIFEST_FILENAME,
  PluginManifestSchema,
  unknownKinds,
  type PluginManifest,
} from "./manifest.js";
import type { DeviceDriver } from "@open-panel/device-sdk";
import type { PluginDefinition, PluginIdentity } from "./types.js";
import { PluginValidationError, validatePluginShape } from "./validate-plugin.js";

/** Debounce for the directory watchers: an editor saving a file emits several events. */
const RELOAD_DEBOUNCE_MS = 150;

export interface PluginContributions {
  /** Present only for plugins that declared `contributes.actions`. */
  actions?: { definition: PluginDefinition; entryPath: string };
  /** Present only for plugins that declared `contributes.devices`. */
  devices?: { drivers: DeviceDriver[]; entryPath: string };
  themes: ThemeManifest[];
  locales: LocaleCatalog[];
}

export interface LoadedPlugin {
  manifest: PluginManifest;
  directory: string;
  contributions: PluginContributions;
  /**
   * Every module this plugin had imported, deduplicated — one entry per file,
   * however many code kinds pointed at it. This is what `onLoad`/`onUnload`
   * run against, so a plugin splitting its actions and its drivers across two
   * files gets both hooks, and one keeping them in a single file gets it once.
   * Empty for a data-only plugin, which is never imported at all.
   */
  modules: PluginDefinition[];
  /** Contributions rejected while loading — one line each, for logs and the UI. */
  problems: string[];
}

/**
 * What one scan changed. A plugin appearing and a plugin disappearing both
 * need the daemon to do something — wire its contributions up, or take them
 * out again — and a scan is the only place that knows which happened.
 */
export interface PluginScan {
  /** Loaded for the first time: their code has never been imported. */
  fresh: LoadedPlugin[];
  /** Listed before this scan and not found by it: uninstalled, or deleted. */
  gone: LoadedPlugin[];
}

export interface PluginRegistryOptions {
  logger?: {
    warn(msg: string, meta?: Record<string, unknown>): void;
    info(msg: string, meta?: Record<string, unknown>): void;
  };
}

/**
 * The one way anything gets into OpenPanel from outside the core: themes,
 * actions, locales and device drivers all arrive as contributions declared in
 * a plugin.json, discovered by the same scan, validated by the same rules,
 * and failing the same way.
 *
 * There is exactly one shape: a directory with a plugin.json in it. A theme is
 * not a loose file, a driver is not a hardcoded `register()` call, and a
 * language is not a compiled-in catalogue — they are all plugins, and there is
 * one thing to learn.
 *
 * The security property the theme system had is kept as an explicit rule:
 * a plugin with no code contribution is never imported. Themes are read as
 * JSON and validated against a schema that admits nothing but hex colours, so
 * a theme still has no way to express a URL, a script, or a CSS declaration.
 *
 * Isolation is per contribution, not per plugin (specs.md Rule 6): a plugin
 * shipping three themes where one has a bad hex loads the other two.
 */
export class PluginRegistry {
  private readonly plugins = new Map<string, LoadedPlugin>();
  private readonly watchers: FSWatcher[] = [];
  private readonly codeLoadedAt = new Map<string, number>();
  /**
   * Imported plugin modules, keyed by entry path rather than by plugin, so a
   * plugin pointing both `contributes.actions` and `contributes.devices` at
   * one file is imported once and its two halves read off the same object.
   */
  private readonly modules = new Map<string, PluginDefinition>();
  private reloadTimer?: ReturnType<typeof setTimeout>;
  private onChanged?: (scan: PluginScan) => void;

  constructor(
    private readonly directories: string[],
    private readonly options: PluginRegistryOptions = {},
  ) {}

  list(): LoadedPlugin[] {
    return [...this.plugins.values()].sort((a, b) =>
      a.manifest.name.localeCompare(b.manifest.name),
    );
  }

  get(pluginId: string): LoadedPlugin | undefined {
    return this.plugins.get(pluginId);
  }

  /**
   * Full scan. Reports what arrived and what left, so the daemon can wire up a
   * new plugin's actions exactly once and take a removed one's back out.
   */
  async load(): Promise<PluginScan> {
    const next = new Map<string, LoadedPlugin>();

    for (const directory of this.directories) {
      for (const pluginDir of await this.scanDirectory(directory)) {
        const loaded = await this.loadPlugin(pluginDir);
        if (!loaded) continue;
        // Later directories win, which is what puts the user's own drop-in
        // ahead of one bundled with the repo.
        const shadowed = next.get(loaded.manifest.id);
        if (shadowed) {
          this.options.logger?.warn("plugin.shadowed", {
            pluginId: loaded.manifest.id,
            kept: loaded.directory,
            shadowed: shadowed.directory,
          });
        }
        next.set(loaded.manifest.id, loaded);
      }
    }

    const fresh = [...next.values()].filter((plugin) => !this.plugins.has(plugin.manifest.id));
    const gone: LoadedPlugin[] = [];

    // A plugin whose directory is gone stops being listed. Its code, if it had
    // any, is still in the module cache — hence the restart note.
    for (const [id, plugin] of this.plugins) {
      if (next.has(id)) continue;
      gone.push(plugin);
      if (plugin.modules.length === 0) continue;
      this.options.logger?.warn("plugin.restart_required", { pluginId: id, reason: "removed" });
    }

    this.plugins.clear();
    for (const [id, plugin] of next) this.plugins.set(id, plugin);
    return { fresh, gone };
  }

  /** Immediate subdirectories of a plugin directory; anything else is not a plugin. */
  private async scanDirectory(directory: string): Promise<string[]> {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      // A missing plugin directory is the normal state on a fresh install.
      return [];
    }
    return entries
      .filter(
        (entry) =>
          entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules",
      )
      .map((entry) => path.join(directory, entry.name));
  }

  async loadPlugin(directory: string): Promise<LoadedPlugin | undefined> {
    const manifestPath = path.join(directory, PLUGIN_MANIFEST_FILENAME);
    let raw: string;
    try {
      raw = await readFile(manifestPath, "utf8");
    } catch {
      this.options.logger?.warn("plugin.manifest_missing", {
        directory,
        expected: PLUGIN_MANIFEST_FILENAME,
      });
      return undefined;
    }

    let manifest: PluginManifest;
    try {
      manifest = PluginManifestSchema.parse(JSON.parse(raw));
    } catch (err) {
      this.options.logger?.warn("plugin.manifest_invalid", {
        manifestPath,
        error: friendlyMessage(err),
      });
      return undefined;
    }

    if (!isApiVersionSupported(manifest.apiVersion)) {
      this.options.logger?.warn("plugin.api_version_unsupported", {
        pluginId: manifest.id,
        requires: manifest.apiVersion,
        supported: PLUGIN_API_VERSION,
      });
      return undefined;
    }

    const problems: string[] = [];
    for (const kind of unknownKinds(manifest)) {
      problems.push(`contributes.${kind}: this version of OpenPanel cannot load that kind.`);
      this.options.logger?.warn("plugin.contribution_unknown_kind", {
        pluginId: manifest.id,
        kind,
      });
    }

    const contributions: PluginContributions = { themes: [], locales: [] };
    const modules: PluginDefinition[] = [];
    const identity: PluginIdentity = { id: manifest.id, name: manifest.name };

    for (const relative of manifest.contributes.themes ?? []) {
      const theme = await this.readData(ThemeManifestSchema, path.join(directory, relative), {
        pluginId: manifest.id,
        kind: "themes",
        problems,
      });
      if (theme) contributions.themes.push(theme);
    }

    for (const relative of manifest.contributes.locales ?? []) {
      const locale = await this.readData(LocaleCatalogSchema, path.join(directory, relative), {
        pluginId: manifest.id,
        kind: "locales",
        problems,
      });
      if (locale) contributions.locales.push(locale);
    }

    if (manifest.contributes.actions) {
      const entryPath = path.join(directory, manifest.contributes.actions);
      const definition = await this.importDefinition(identity, entryPath, problems);
      const actionCount = Object.keys(definition?.actions ?? {}).length;
      if (definition && actionCount === 0) {
        // Declaring the kind and exposing no action is a silent no-op install
        // otherwise — the plugin loads, lists cleanly, and contributes nothing.
        const reason = "declares contributes.actions but its module exposes none.";
        problems.push(`${path.basename(entryPath)}: ${reason}`);
        this.options.logger?.warn("plugin.contribution_rejected", {
          pluginId: manifest.id,
          kind: "actions",
          entryPath,
          error: reason,
        });
      } else if (definition) {
        contributions.actions = { definition, entryPath };
        if (!modules.includes(definition)) modules.push(definition);
      }
    }

    if (manifest.contributes.devices) {
      const entryPath = path.join(directory, manifest.contributes.devices);
      const definition = await this.importDefinition(identity, entryPath, problems);
      const drivers = definition?.devices ?? [];
      if (definition && drivers.length === 0) {
        // Declaring the kind and exporting no driver is a silent no-device
        // install otherwise — the hardest failure for an author to chase.
        const reason = "declares contributes.devices but its module exports none.";
        problems.push(`${path.basename(entryPath)}: ${reason}`);
        this.options.logger?.warn("plugin.contribution_rejected", {
          pluginId: manifest.id,
          kind: "devices",
          entryPath,
          error: reason,
        });
      } else if (definition) {
        contributions.devices = { drivers, entryPath };
        if (!modules.includes(definition)) modules.push(definition);
      }
    }

    this.options.logger?.info("plugin.loaded", {
      pluginId: manifest.id,
      version: manifest.version,
      contributes: declaredKinds(manifest),
      problems: problems.length,
    });
    return { manifest, directory, contributions, modules, problems };
  }

  /**
   * Reads one data contribution. Every data kind goes through here, so a theme
   * and a locale fail identically: the file is named, the first schema problem
   * is quoted, and the plugin's other contributions carry on loading.
   */
  private async readData<T>(
    schema: { parse(value: unknown): T },
    filePath: string,
    context: { pluginId: string; kind: string; problems: string[] },
  ): Promise<T | undefined> {
    try {
      return schema.parse(JSON.parse(await readFile(filePath, "utf8")));
    } catch (err) {
      const reason = friendlyMessage(err);
      context.problems.push(`${path.basename(filePath)}: ${reason}`);
      this.options.logger?.warn("plugin.contribution_rejected", {
        pluginId: context.pluginId,
        kind: context.kind,
        filePath,
        error: reason,
      });
      return undefined;
    }
  }

  /**
   * The only place a plugin's code is imported, reached only when the manifest
   * declared a code contribution. Node caches modules by URL, so an already
   * imported entry comes back unchanged — a code edit needs a daemon restart,
   * and the author is told that rather than left wondering.
   */
  private async importDefinition(
    identity: PluginIdentity,
    entryPath: string,
    problems: string[],
  ): Promise<PluginDefinition | undefined> {
    const existing = this.modules.get(entryPath);
    if (existing) {
      if (await this.hasChangedSinceLoad(entryPath)) {
        this.options.logger?.info("plugin.restart_required", {
          pluginId: identity.id,
          reason: "code_changed",
        });
      }
      return existing;
    }

    try {
      const mod = (await import(pathToFileURL(entryPath).href)) as { default?: unknown };
      const definition = validatePluginShape(identity, unwrapDefault(mod.default));
      await this.hasChangedSinceLoad(entryPath);
      this.modules.set(entryPath, definition);
      return definition;
    } catch (err) {
      const reason =
        err instanceof PluginValidationError ? err.message : (missingPackage(err) ?? String(err));
      problems.push(`${path.basename(entryPath)}: ${reason}`);
      this.options.logger?.warn("plugin.contribution_rejected", {
        pluginId: identity.id,
        kind: "code",
        entryPath,
        error: reason,
      });
      return undefined;
    }
  }

  private async hasChangedSinceLoad(entryPath: string): Promise<boolean> {
    try {
      const mtime = (await stat(entryPath)).mtimeMs;
      const seen = this.codeLoadedAt.get(entryPath);
      this.codeLoadedAt.set(entryPath, mtime);
      return seen !== undefined && mtime > seen;
    } catch {
      return false;
    }
  }

  /**
   * Re-scans whenever anything in the directories changes, then calls back so
   * the daemon can re-feed the typed registries and tell connected clients.
   * This is what makes editing a theme file a live experience.
   *
   * The callback receives what the scan changed. A plugin that has just
   * appeared has never been imported and can be activated straight away; one
   * that has gone needs its contributions taken back out. A plugin whose code
   * *was* already imported keeps the definition it was loaded with; Node
   * caches modules by URL and the registry logs plugin.restart_required rather
   * than pretending.
   */
  watchForChanges(onChanged: (scan: PluginScan) => void): void {
    this.onChanged = onChanged;
    for (const directory of this.directories) {
      const watcher = this.watchDirectory(directory);
      if (watcher) this.watchers.push(watcher);
    }
  }

  /**
   * Recursive watching is what catches a theme edited inside a plugin's own
   * directory, but Linux does not support it. Falling back to a flat watch
   * there still notices a plugin appearing or disappearing.
   */
  private watchDirectory(directory: string): FSWatcher | undefined {
    try {
      return watch(directory, { recursive: true }, () => this.scheduleReload());
    } catch {
      try {
        return watch(directory, () => this.scheduleReload());
      } catch {
        // Directory does not exist yet, or the platform cannot watch it.
        // Plugins still load at startup; only live reload is unavailable.
        return undefined;
      }
    }
  }

  private scheduleReload(): void {
    clearTimeout(this.reloadTimer);
    this.reloadTimer = setTimeout(() => {
      void this.load().then((scan) => this.onChanged?.(scan));
    }, RELOAD_DEBOUNCE_MS);
  }

  close(): void {
    clearTimeout(this.reloadTimer);
    for (const watcher of this.watchers) watcher.close();
    this.watchers.length = 0;
  }
}

/**
 * Digs the definition out of one more layer of `default` when there is one.
 *
 * A bundled plugin shipped as `.js` with no `package.json` declaring
 * `"type": "module"` is CommonJS to Node, so its ESM is transformed and comes
 * back as `{ default: { default: <the definition> } }`. The outer object is a
 * perfectly valid plugin shape — an object contributing nothing — so it used to
 * load, report no problem, and register no actions at all.
 *
 * Only unwrapped when the outer object carries neither contribution and the
 * inner one does, which cannot be confused with a plugin that genuinely meant
 * to export something called `default`.
 *
 * Exported for its own test: the wrapping comes from Node's CommonJS interop,
 * which a test running under Vite's module runner cannot produce.
 */
export function unwrapDefault(exported: unknown): unknown {
  if (typeof exported !== "object" || exported === null) return exported;
  const outer = exported as PluginDefinition & { default?: PluginDefinition };
  if (outer.actions || outer.devices) return outer;
  const inner = outer.default;
  if (inner && typeof inner === "object" && (inner.actions || inner.devices)) return inner;
  return outer;
}

/**
 * Turns Node's resolver error into the sentence an author can act on.
 *
 * A plugin importing a package the app does not provide is the most common way
 * for one to fail, and "ERR_MODULE_NOT_FOUND ... imported from
 * C:\Users\...\src\index.ts" says nothing about what to do. The fix is always
 * the same: bundle it. Returns undefined for any other error, which then
 * reports as it always did.
 *
 * Exported for its own test: the failure it formats comes from Node's real ESM
 * resolver, which a test running under Vite's module runner cannot provoke.
 */
export function missingPackage(err: unknown): string | undefined {
  if ((err as NodeJS.ErrnoException)?.code !== "ERR_MODULE_NOT_FOUND") return undefined;
  const name = /Cannot find (?:package|module) '([^']+)'/.exec(String(err))?.[1];
  if (!name) return undefined;
  return (
    `imports "${name}", which OpenPanel does not provide. ` +
    `Bundle it into your plugin's code at build time (esbuild, rollup, tsup), ` +
    `keeping @open-panel/* external.`
  );
}

/** Zod errors stringify to a wall of JSON; the first issue is what an author needs. */
function friendlyMessage(err: unknown): string {
  if (err && typeof err === "object" && "issues" in err) {
    const issues = (err as { issues: { path: (string | number)[]; message: string }[] }).issues;
    const first = issues[0];
    if (first) {
      const where = first.path.join(".");
      return where ? `${where}: ${first.message}` : first.message;
    }
  }
  return err instanceof Error ? err.message : String(err);
}
