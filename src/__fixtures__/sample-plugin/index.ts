import { definePlugin } from "../../define-plugin.js";

export default definePlugin({
  actions: {
    ping: {
      name: "Ping",
      async execute(ctx) {
        ctx.log("info", "pong");
      },
    },
  },
});
