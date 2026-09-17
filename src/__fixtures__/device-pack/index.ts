import type { DeckDevice, DeviceDriver } from "@open-panel/device-sdk";
import { definePlugin } from "../../define-plugin.js";

/**
 * One file contributing both kinds — the case that proves a plugin's module is
 * imported once and read twice, rather than evaluated per contribution.
 */
const driver: DeviceDriver = {
  driverId: "pretend",
  async discover(): Promise<DeckDevice[]> {
    return [];
  },
};

export default definePlugin({
  actions: {
    ping: {
      name: "Ping",
      async execute(ctx) {
        ctx.log("info", "pong");
      },
    },
  },
  devices: [driver],
});
