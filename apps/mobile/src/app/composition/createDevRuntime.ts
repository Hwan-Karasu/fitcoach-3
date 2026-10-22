import { createRuntime } from "./createServices.ts";
export const createDevRuntime = () => createRuntime("development");
