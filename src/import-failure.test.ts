import { describe, expect, it } from "vitest";
import { missingPackage } from "./registry.js";

/**
 * The message an author reads when their plugin does not load.
 *
 * It is worth its own test because it is the only guidance that reaches
 * someone who imported a library and did not bundle it — the raw resolver
 * error names a file path and a specifier and says nothing about what to do,
 * and it is what the desktop shows on the plugin's row.
 */

/** What Node throws: a plain Error carrying the code the check keys off. */
function resolverError(specifier: string): Error {
  const err = new Error(
    `Cannot find package '${specifier}' imported from C:\\Users\\a\\.openpanel\\plugins\\p\\index.ts`,
  );
  (err as NodeJS.ErrnoException).code = "ERR_MODULE_NOT_FOUND";
  return err;
}

describe("missingPackage", () => {
  it("names the package and says what to do about it", () => {
    const message = missingPackage(resolverError("moment"));

    expect(message).toContain('imports "moment"');
    expect(message).toContain("does not provide");
    expect(message).toMatch(/[Bb]undle it into your plugin/);
  });

  it("tells the author to keep the SDK external, which a bundler will not guess", () => {
    // Inlining @open-panel/* would give the plugin a second copy of the SDK
    // rather than the one the daemon is running.
    expect(missingPackage(resolverError("dockerode"))).toContain("@open-panel/* external");
  });

  it("handles the CommonJS wording of the same failure", () => {
    const err = new Error("Cannot find module 'lodash'");
    (err as NodeJS.ErrnoException).code = "ERR_MODULE_NOT_FOUND";

    expect(missingPackage(err)).toContain('imports "lodash"');
  });

  it("leaves any other failure alone", () => {
    // A plugin that threw on import, or exported the wrong shape, is a
    // different problem and its own error already says so.
    expect(missingPackage(new Error("boom"))).toBeUndefined();
    expect(missingPackage(undefined)).toBeUndefined();
  });

  it("leaves a resolver error it cannot parse alone", () => {
    const err = new Error("something else entirely");
    (err as NodeJS.ErrnoException).code = "ERR_MODULE_NOT_FOUND";

    expect(missingPackage(err)).toBeUndefined();
  });
});
