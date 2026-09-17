# @open-panel/plugin-sdk

The plugin SDK for [OpenPanel](https://github.com/open-panel/openPanel):
the `plugin.json` manifest schema, a `PluginRegistry` that discovers and
validates plugins with per-contribution isolation and live reload, the
capability surface a plugin's code runs against (`log`/`shell`/`http`/
`storage`/`notify`/`device`), and the adapter that turns a plugin's actions
into regular `ActionDefinition`s namespaced as `<pluginId>.<actionKey>`.

Themes, locales, actions and device drivers all arrive through this one
mechanism — a directory with a `plugin.json` in it, discovered by the same
scan, validated by the same rules, isolated per contribution rather than per
plugin (one bad theme in a plugin doesn't take its other contributions down).

Requires Node — plugin discovery reads the filesystem and dynamically
imports plugin entry points.

## Install

```bash
npm install @open-panel/plugin-sdk
```

If you're writing a plugin, this is a devDependency: `definePlugin` and the
types it gives you are compiled away, and the plugin actually runs inside a
host application that already has this SDK loaded.

## What's in here

- **`definePlugin(definition)`** — identity function that gives plugin
  authors type-checking and IDE completion for a `PluginDefinition`
  (`actions`, `devices`, `onLoad`, `onUnload`). This is the whole authoring
  API: write a `plugin.json` and export `definePlugin({ ... })` as default.
- **`PluginManifestSchema` / `PluginManifest`** — the `plugin.json` shape:
  `id`, `name`, `version`, `apiVersion`, and `contributes` (actions, devices,
  themes, locales).
- **`PluginRegistry`** — `new PluginRegistry(directories, options)`, then
  `load()` to scan and import every plugin, `list()`/`get(pluginId)` to read
  what loaded, and `watchForChanges(onChanged)` for live reload as plugin
  files change on disk.
- **Capabilities** — `PluginCapabilities`/`PluginLifecycleContext`/
  `PluginActionContext`: the only surface a plugin's code touches
  (`ctx.log`, `ctx.shell`, `ctx.http`, `ctx.storage`, `ctx.notify`,
  `ctx.device`), and `createDefaultCapabilities()` for a host wiring up a
  sandbox for the first time.
- **`toActionDefinitions(...)`** — the adapter that turns a plugin's
  `PluginActionDefinition`s into `@open-panel/action-engine`
  `ActionDefinition`s, namespaced `<pluginId>.<actionKey>`.
- **Validation** — `validatePluginShape`, `validatePluginConfig`,
  `PluginValidationError`, `PluginConfigError`, `isApiVersionSupported`,
  `declaredKinds`/`unknownKinds`.

## Usage

Authoring a plugin (its code half — see `plugin.json` for the identity half):

```ts
// plugin's entry point, referenced from plugin.json's contributes.actions
import { definePlugin } from "@open-panel/plugin-sdk";

export default definePlugin({
  actions: {
    ping: {
      name: "Ping",
      async execute(ctx) {
        await ctx.notify("OpenPanel", "pong");
      },
    },
  },
});
```

Loading plugins in a host application:

```ts
import { PluginRegistry } from "@open-panel/plugin-sdk";

const registry = new PluginRegistry(["./plugins", "~/.openpanel/plugins"]);
const scan = await registry.load();

for (const plugin of registry.list()) {
  console.log(plugin.manifest.id, plugin.problems);
}
```

## Related packages

- [`@open-panel/shared`](https://www.npmjs.com/package/@open-panel/shared) — theme/locale types validated here
- [`@open-panel/device-sdk`](https://www.npmjs.com/package/@open-panel/device-sdk) — the `DeviceDriver` interface a plugin's `devices` contribution implements
- [`@open-panel/action-engine`](https://www.npmjs.com/package/@open-panel/action-engine) — where `toActionDefinitions` output gets registered

## License

MIT © [OpenPanel contributors](https://github.com/open-panel/package-plugin-sdk/blob/main/LICENSE)
