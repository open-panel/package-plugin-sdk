import { describe, expect, it } from "vitest";
import { PluginConfigError, validatePluginConfig } from "./config-schema.js";

describe("validatePluginConfig", () => {
  const schema = { container: { type: "string" as const, required: true } };

  it("accepts valid config", () => {
    expect(validatePluginConfig("Restart Container", schema, { container: "web" })).toEqual({
      container: "web",
    });
  });

  it("rejects missing required fields", () => {
    expect(() => validatePluginConfig("Restart Container", schema, {})).toThrow(PluginConfigError);
  });

  it("applies defaults for optional fields", () => {
    const withDefault = { count: { type: "number" as const, default: 1 } };
    expect(validatePluginConfig("Scale", withDefault, {})).toEqual({ count: 1 });
  });

  it("passes through config unchanged when no schema is declared", () => {
    expect(validatePluginConfig("Anything", undefined, { free: "form" })).toEqual({ free: "form" });
  });
});
