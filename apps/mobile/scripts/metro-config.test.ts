import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import config from "../metro.config.ts";

test("F02 Metro ignores generated caches/builds while retaining source, assets and dependencies", () => {
  const patterns = Array.isArray(config.resolver.blockList) ? config.resolver.blockList : [config.resolver.blockList];
  assert.equal(new Set(patterns.filter(Boolean).map((pattern) => pattern!.flags)).size, 1, "Expo composes patterns with matching flags");
  const ignored = (path: string) => patterns.some((pattern) => pattern?.test(path));
  for (const relative of [".npm-cache", ".npm-cache/_cacache/index-v5", "android/app/build", "dist/assets", "ios/build"]) {
    const absolute = join(config.projectRoot, relative);
    assert.ok(ignored(absolute), absolute);
    assert.ok(ignored(absolute.replaceAll("\\", "/")), "Metro uses normalized paths when crawling");
  }
  for (const relative of ["src/app/navigation/ClientPrimaryNavigators.tsx", "assets/exercises/image.png",
    "node_modules/react-native/index.js", "node_modules/package/android/index.js", "scripts/mobile.ts"]) {
    assert.equal(ignored(join(config.projectRoot, relative)), false, relative);
  }
});
