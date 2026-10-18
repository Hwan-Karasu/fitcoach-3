import { createRequire } from "node:module";
import { dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { getDefaultConfig } = require("expo/metro-config") as typeof import("expo/metro-config");
const projectRoot = dirname(fileURLToPath(import.meta.url));
const config = getDefaultConfig(projectRoot);
const escapedRoot = projectRoot.split(sep).map((part) => part.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")).join("[\\\\/]");
// Windows uses Metro's fallback watcher: each directory consumes a handle. These generated directories
// are not JS/asset inputs; watching the local npm cache and native build/export output can exhaust handles.
const defaults = config.resolver.blockList;
const patterns = Array.isArray(defaults) ? defaults : defaults ? [defaults] : [];
// Expo combines these regexes and requires identical flags.
const generated = new RegExp(`^${escapedRoot}[\\\\/](?:\\.npm-cache|android|ios|dist)(?:[\\\\/]|$)`, patterns[0]?.flags ?? "");
config.resolver.blockList = [...patterns, generated];

export default config;
