import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { baselineSteps, buildChainSchema, renderBaselineFile, SCHEMA_OWNERS } from "./BaselineSchema.ts";

/**
 * D01: записывает базовую миграцию каждого владельца из итоговой схемы dev-цепочки.
 * Запуск: node --experimental-strip-types scripts/d01/generate-baseline.ts
 */
const { byOwner } = await buildChainSchema();
const root = resolve(import.meta.dirname, "../../apps/mobile/src");
for (const owner of SCHEMA_OWNERS) {
  const steps = baselineSteps(byOwner.get(owner.owner) ?? [], owner.owner);
  const target = resolve(root, owner.file);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, renderBaselineFile(owner, steps), "utf8");
  console.log(`${owner.owner}: ${steps[0]!.statements.length} объектов → ${owner.file}`);
}
