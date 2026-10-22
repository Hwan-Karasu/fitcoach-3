import { createRuntime } from "./createServices.ts";
export const createProductionRuntime = () => createRuntime("production");
