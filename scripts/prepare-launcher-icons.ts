import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Use the same image pipeline as Expo prebuild. Keep the supplied artwork intact;
// the adaptive layers need transparent space for Android's launcher masks.
const require = createRequire(new URL("../apps/mobile/package.json", import.meta.url));
const images = require("@expo/image-utils") as {
  generateImageAsync(options: { projectRoot: string }, image: { src: string; width: number; height: number; resizeMode: "contain"; backgroundColor: string }): Promise<{ source: Buffer }>;
  generateImageBackgroundAsync(options: { width: number; height: number; resizeMode: "contain"; backgroundColor: string }): Promise<Buffer>;
  compositeImagesAsync(options: { foreground: Buffer; background: Buffer; x: number; y: number }): Promise<Buffer>;
};
const projectRoot = fileURLToPath(new URL("../apps/mobile", import.meta.url));
for (const name of ["foreground", "monochrome"]) {
  const { source } = await images.generateImageAsync({ projectRoot }, { src: fileURLToPath(new URL(`../apps/mobile/assets/brand/source-${name}.png`, import.meta.url)), width: 640, height: 640, resizeMode: "contain", backgroundColor: "transparent" });
  const background = await images.generateImageBackgroundAsync({ width: 1024, height: 1024, resizeMode: "contain", backgroundColor: "transparent" });
  writeFileSync(new URL(`../apps/mobile/assets/brand/adaptive-${name}.png`, import.meta.url), await images.compositeImagesAsync({ foreground: source, background, x: 192, y: 192 }));
}
console.log("Android adaptive layers prepared with launcher mask margins.");
