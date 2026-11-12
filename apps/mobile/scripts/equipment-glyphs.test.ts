import assert from "node:assert/strict";
import test from "node:test";
import { KNOWN_EQUIPMENT } from "../src/features/exercises/domain/ExerciseLabels.ts";
import { approvedEquipmentGlyphs } from "../src/features/exercises/presentation/approvedEquipmentGlyphs.generated.ts";

/** Оборудование, для которого в папке владельца нет подходящего файла: остаётся прежний нарисованный значок (2026-11-12). */
const KEPT_PREVIOUS = ["battle_rope", "climbing_rope", "flat_bench", "stability_ball"];

test("у всего оборудования, кроме согласованных исключений, есть значок владельца", () => {
  const missing = KNOWN_EQUIPMENT.filter((id) => approvedEquipmentGlyphs[id] === undefined).sort();
  assert.deepEqual(missing, KEPT_PREVIOUS);
});

test("значки владельца красятся темой и не содержат внешних ссылок", () => {
  for (const [id, svg] of Object.entries(approvedEquipmentGlyphs)) {
    assert.ok(svg.startsWith("<svg"), id);
    assert.ok(svg.includes("currentColor"), `${id}: цвет должен задаваться темой`);
    assert.doesNotMatch(svg, /<(?:script|image|foreignObject)\b|base64|\bhref\s*=/iu, id);
    assert.doesNotMatch(svg, /fill="(?:#|rgb)/u, `${id}: зашитый цвет заливки`);
    assert.ok(KNOWN_EQUIPMENT.includes(id), `${id}: нет такого оборудования`);
  }
});

test("замечания владельца к макету: бёдра, пек-дек, петли TRX, разгибание спины", () => {
  const glyph = approvedEquipmentGlyphs;
  assert.notEqual(glyph.hip_adduction_machine, glyph.hip_abduction_machine);
  assert.equal(glyph.pec_deck, glyph.chest_fly_machine);
  assert.notEqual(glyph.pec_deck, glyph.lat_pulldown_machine);
  assert.notEqual(glyph.suspension_trainer, glyph.pull_up_bar);
  assert.ok(glyph.back_extension_machine !== undefined && glyph.back_extension_machine.length > 1000);
});

test("значки из трассировки центрированы по рисунку и квадратные (блины не прижаты к краю)", () => {
  const plates = approvedEquipmentGlyphs.plates!;
  const [x, y, w, h] = /viewBox="([^"]+)"/u.exec(plates)![1]!.split(" ").map(Number) as [number, number, number, number];
  assert.equal(w, h);
  const numbers = /\sd="([^"]+)"/u.exec(plates)![1]!.replace(/[MLQZ]/gu, " ").trim().split(/\s+/u).map(Number);
  const xs = numbers.filter((_, i) => i % 2 === 0), ys = numbers.filter((_, i) => i % 2 === 1);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  assert.ok(Math.abs(x + w / 2 - cx) <= 2 && Math.abs(y + h / 2 - cy) <= 2, "центр рисунка совпадает с центром окна");
  assert.ok(Math.max(...xs) - Math.min(...xs) < w, "вокруг рисунка есть поле");
});

test("бюджет размера: значки не раздувают пакет", () => {
  const sizes = Object.entries(approvedEquipmentGlyphs).map(([id, svg]) => [id, Buffer.byteLength(svg)] as const);
  for (const [id, size] of sizes) assert.ok(size <= 60 * 1024, `${id}: ${size} байт`);
  assert.ok(sizes.reduce((sum, [, size]) => sum + size, 0) <= 700 * 1024);
});
