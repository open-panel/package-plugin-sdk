// Declares contributes.actions and exposes no action — the silent no-op
// install the registry has to turn into a named problem. This is the shape a
// bundled plugin used to arrive in when Node read it as CommonJS: an object
// with neither contribution on it, which validated perfectly and did nothing.
import { definePlugin } from "../../define-plugin.js";

export default definePlugin({});
