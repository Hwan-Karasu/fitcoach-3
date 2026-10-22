/** Compatibility entry for the development runtime; ordinary boot uses createProductionRuntime. */
export { createDevRuntime } from "./createDevRuntime.ts";
export type { ApplicationServices as DevServices, ApplicationRuntime as DevRuntime } from "./createServices.ts";
