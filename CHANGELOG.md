# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/).

## [0.1.0]

### Added

- `plugin.json` manifest schema and `PLUGIN_API_VERSION`.
- `definePlugin` authoring helper.
- `PluginRegistry`: discovery, per-contribution validation and isolation,
  live reload via filesystem watching.
- Plugin capability surface (`log`/`shell`/`http`/`storage`/`notify`/`device`)
  and `createDefaultCapabilities()`.
- `toActionDefinitions` adapter from plugin actions to
  `@open-panel/action-engine` `ActionDefinition`s.
