import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ConfigT } from "@expo/metro/metro-config";

const require = createRequire(import.meta.url);
const { getDefaultConfig } = require("expo/metro-config") as typeof import("expo/metro-config");
const projectRoot = dirname(fileURLToPath(import.meta.url));
const mobileRoot = resolve(projectRoot, "../../apps/mobile");
const config = getDefaultConfig(projectRoot);
export default {
  ...config,
  watchFolders: [resolve(mobileRoot, "src"), resolve(mobileRoot, "node_modules")],
  resolver: {
    ...config.resolver,
    nodeModulesPaths: [resolve(projectRoot, "node_modules"), resolve(mobileRoot, "node_modules")],
    resolveRequest(context, name, platform) {
      // Shared app source must use the spike's single React/Expo runtime, while normal
      // hierarchical resolution remains available for nested Expo dependencies.
      const singleton = /^(?:react|react-native|expo|expo-modules-core|expo-sqlite)(?:\/|$)/u.test(name);
      return context.resolveRequest(singleton ? { ...context, originModulePath: resolve(projectRoot, "index.ts") } : context, name, platform);
    },
  },
} satisfies ConfigT;
