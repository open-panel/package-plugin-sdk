import { describe, expect, it } from "vitest";
import { unwrapDefault } from "./registry.js";

/**
 * Node's CommonJS interop, which is how a bundled plugin shipped as `.js` with
 * no `"type": "module"` above it arrives: transformed to CJS, then handed back
 * through `import()` as `{ default: { default: <the definition> } }`.
 *
 * The outer object is a valid plugin shape — one contributing nothing — so it
 * used to load, report no problem, and register no actions. Packaged plugins
 * ship `.mjs` now, but a hand-built one will not always, and silently doing
 * nothing is the worst way to tell someone.
 */

const withActions = { actions: { ping: { name: "Ping", execute: () => {} } } };
const withDevices = { devices: [{ driverId: "d", discover: () => [] }] };

describe("unwrapDefault", () => {
  it("digs the definition out of the interop wrapper", () => {
    expect(unwrapDefault({ default: withActions })).toBe(withActions);
    expect(unwrapDefault({ default: withDevices })).toBe(withDevices);
  });

  it("leaves a plain definition alone", () => {
    expect(unwrapDefault(withActions)).toBe(withActions);
  });

  it("keeps a definition that contributes something and also has a default", () => {
    // Not the interop shape: this one means what it says, and taking the inner
    // object would throw away the contributions on the outer one.
    const both = { ...withActions, default: withDevices };
    expect(unwrapDefault(both)).toBe(both);
  });

  it("leaves an empty object alone, so it still reports as contributing nothing", () => {
    const empty = {};
    expect(unwrapDefault(empty)).toBe(empty);
    expect(unwrapDefault({ default: {} })).toEqual({ default: {} });
  });

  it("passes anything that is not an object straight through", () => {
    expect(unwrapDefault(undefined)).toBeUndefined();
    expect(unwrapDefault(null)).toBeNull();
    expect(unwrapDefault("nope")).toBe("nope");
  });
});
