import { z } from "zod";

/**
 * Every extension is a plugin, and every plugin is a directory holding this
 * file. The manifest is the one place identity lives — a theme no longer
 * carries its own author field while a code plugin carries a different one,
 * and nothing is discovered by being hardcoded into the daemon.
 *
 * What a plugin actually *does* is `contributes`: a typed bag with one key per
 * contribution kind. A plugin may fill any mix of them, or just one.
 */
export const PLUGIN_MANIFEST_FILENAME = "plugin.json";

/**
 * The plugin API's major version (specs.md #17: "Plugin APIs MUST be
 * versioned"). Bumped when a change would break a plugin written against the
 * previous one; plugins declare the major they were built for and are skipped
 * with a warning rather than crashing against an API they do not understand.
 */
export const PLUGIN_API_VERSION = 1;

/** Lowercase kebab, so a plugin id is safe in an action type and a file path. */
const PluginIdSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]*$/, "must be lowercase letters, digits and dashes");

/**
 * Paths are relative to the plugin directory and may not escape it: a plugin
 * declaring "../../../etc/passwd" as a theme must not be able to read it.
 */
const ContributionPathSchema = z
  .string()
  .min(1)
  .refine((value) => !value.startsWith("/") && !value.includes(".."), {
    message: "must be a relative path inside the plugin directory",
  });

/**
 * Unknown keys pass through rather than failing the manifest: a plugin built
 * for a later version of OpenPanel should lose the contribution this app
 * cannot use, not all of them. The registry warns per unknown kind.
 */
const PluginContributesSchema = z
  .object({
    /** Module whose default export is a `definePlugin(...)` result. */
    actions: ContributionPathSchema.optional(),
    /** Theme JSON files. Data only — never imported, see PluginRegistry. */
    themes: z.array(ContributionPathSchema).min(1).optional(),
    /** Locale catalogue JSON files. Data only, same as themes. */
    locales: z.array(ContributionPathSchema).min(1).optional(),
    /**
     * Module whose default export is a `definePlugin(...)` carrying device
     * drivers. A device adapter is a plugin like any other: FIFINE D6 is
     * discovered by the same scan as a theme pack, not by a line in the
     * daemon (specs.md Rule 3).
     */
    devices: ContributionPathSchema.optional(),
  })
  .passthrough();

/** The kinds this version of the app knows how to load. */
const CONTRIBUTION_KINDS = ["actions", "themes", "locales", "devices"] as const;
type ContributionKind = (typeof CONTRIBUTION_KINDS)[number];

export const PluginManifestSchema = z.object({
  manifestVersion: z.literal(1),
  id: PluginIdSchema,
  name: z.string().min(1),
  version: z.string().min(1),
  description: z.string().optional(),
  author: z.string().optional(),
  homepage: z.string().optional(),
  /** Which plugin API major this was written against, e.g. "^1". */
  apiVersion: z.string().default(`^${PLUGIN_API_VERSION}`),
  contributes: PluginContributesSchema.default({}),
});

export type PluginManifest = z.infer<typeof PluginManifestSchema>;

/**
 * A deliberately small check: only the major matters, because only a major
 * bump breaks a plugin. Accepts what a plugin author would plausibly write —
 * "1", "^1", "~1.2", ">=1.0.0", "1.x" — and rejects anything it cannot read,
 * since guessing at a range is worse than telling the author to simplify it.
 */
export function isApiVersionSupported(range: string): boolean {
  const major = /^[\^~]?(?:>=)?\s*(\d+)/.exec(range.trim());
  return major ? Number(major[1]) === PLUGIN_API_VERSION : false;
}

/** The kinds a manifest actually declares, ignoring ones this app does not know. */
export function declaredKinds(manifest: PluginManifest): ContributionKind[] {
  return CONTRIBUTION_KINDS.filter((kind) => manifest.contributes[kind] !== undefined);
}

/** Kinds present in the manifest that this version of the app cannot load. */
export function unknownKinds(manifest: PluginManifest): string[] {
  return Object.keys(manifest.contributes).filter(
    (key) => !CONTRIBUTION_KINDS.includes(key as ContributionKind),
  );
}
