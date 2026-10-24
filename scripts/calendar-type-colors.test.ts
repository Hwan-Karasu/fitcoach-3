import assert from "node:assert/strict";
import test from "node:test";
import type { SessionType } from "../apps/mobile/src/features/calendar/domain/CalendarModel.ts";
import { DEFAULT_DUTY_COLOR, resolveDutyColor, resolveTypeColors, sessionTypeColorHex } from "../apps/mobile/src/features/calendar/presentation/calendarTypeColors.ts";

const type = (id: string, color: SessionType["color"] = null, archived = false): SessionType => ({
  id, name: id, color, archived, category: "OTHER", defaultDurationMinutes: 60, requiresCredit: false, inUse: false,
});

test("calendar assigns distinct colours to legacy automatic/duplicate types and reserves duty", () => {
  const types = [type("personal"), type("instruction", "blue"), type("consultation", "blue"), type("guest"), type("study")];
  const duty = resolveDutyColor("#8A5A00");
  const resolved = resolveTypeColors(types, duty);
  assert.equal(resolved.size, types.length);
  assert.equal(resolved.get("instruction"), "blue");
  const colours = [...resolved.values()].map((key) => sessionTypeColorHex[key]);
  assert.equal(new Set([duty, ...colours]).size, types.length + 1);
  assert.deepEqual(resolveTypeColors(types, duty), resolved);
  assert.equal(types[0]?.color, null);
});

test("archived types release their swatches; explicit selections remain stable", () => {
  const resolved = resolveTypeColors([type("archived", "teal", true), type("first", "blue"), type("second")], DEFAULT_DUTY_COLOR);
  assert.equal(resolved.has("archived"), false);
  assert.equal(resolved.get("first"), "blue");
  assert.equal(resolved.get("second"), "teal");
  assert.equal(new Set([DEFAULT_DUTY_COLOR, ...Object.values(sessionTypeColorHex)]).size, 7);
});

test("old duty shades resolve to the single canonical swatch for their colour family", () => {
  assert.equal(resolveDutyColor("#8a5a00"), sessionTypeColorHex.amber);
  assert.equal(resolveDutyColor("#0E6E73"), sessionTypeColorHex.teal);
  assert.equal(resolveDutyColor("#A3324F"), sessionTypeColorHex.rose);
  assert.equal(resolveDutyColor(null), DEFAULT_DUTY_COLOR);
  assert.equal(resolveDutyColor("bad"), DEFAULT_DUTY_COLOR);
});
