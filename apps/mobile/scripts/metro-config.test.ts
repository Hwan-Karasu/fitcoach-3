import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import config from "../metro.config.ts";
import { boundedCache } from "./bounded-cache.ts";

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

test("F02 bounded cache shares a limit across reads/writes and releases slots after failures", async () => {
  let active = 0;
  let peak = 0;
  const values = new Map<string, string>();
  const io = async <T>(operation: () => T) => {
    active += 1; peak = Math.max(active, peak);
    await new Promise<void>((resolve) => setTimeout(resolve, 1));
    try { return operation(); } finally { active -= 1; }
  };
  const cache = boundedCache({
    get: (key: Buffer) => io(() => { if (key.toString() === "fail") throw new Error("IO_FAILURE"); return values.get(key.toString()) ?? null; }),
    set: (key: Buffer, value: string) => io(() => { values.set(key.toString(), value); }),
    clear: () => { values.clear(); },
  }, 4);
  const writes = Array.from({ length: 100 }, (_, i) => cache.set(Buffer.from(String(i)), `v${i}`));
  const failure = assert.rejects(cache.get(Buffer.from("fail")), /IO_FAILURE/u);
  await Promise.all([...writes, failure]);
  const reads = await Promise.all(Array.from({ length: 100 }, (_, i) => cache.get(Buffer.from(String(i)))));
  assert.deepEqual(reads, Array.from({ length: 100 }, (_, i) => `v${i}`));
  assert.equal(peak, 4);
  assert.equal(active, 0);
  assert.equal(await cache.get(Buffer.from("missing")), null);
  cache.clear();
  assert.equal(await cache.get(Buffer.from("0")), null);
});
