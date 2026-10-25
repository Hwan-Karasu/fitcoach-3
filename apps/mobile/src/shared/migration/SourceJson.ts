/** Read exact numeric source tokens instead of using rounded native values.
 * The native parser validates the grammar; the lexer only shields numeric tokens.
 * No reviver context, Node API, global patch or dependency on a legacy schema.
 */
export function parseSourceJson(text: string, number: (key: string, source: string) => unknown): unknown {
  const invalid = (): never => { throw new SyntaxError("IMPORT_SOURCE_JSON_INVALID"); };
  if (typeof text !== "string") return invalid();
  let validated: unknown;
  try { validated = JSON.parse(text) as unknown; } catch { return invalid(); }

  // A source string must never be mistaken for one of our temporary number tags.
  const strings: string[] = [], pending: unknown[] = [validated];
  while (pending.length) {
    const value = pending.pop();
    if (typeof value === "string") strings.push(value);
    else if (value !== null && typeof value === "object") {
      for (const key of Object.keys(value)) pending.push((value as Record<string, unknown>)[key]);
    }
  }
  let tag = "\u0000source-number:";
  while (strings.some((value) => value.startsWith(tag))) tag += ":";

  const tokens = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
  const parts: string[] = [];
  let position = 0, copiedUntil = 0;
  while (position < text.length) {
    const char = text[position]!;
    if (char === '"') {
      position++;
      while (position < text.length) {
        const current = text[position++]!;
        if (current === "\\") position++;
        else if (current === '"') break;
      }
    } else if (char === "-" || char >= "0" && char <= "9") {
      tokens.lastIndex = position;
      const token = tokens.exec(text)?.[0];
      if (!token) return invalid();
      parts.push(text.slice(copiedUntil, position), JSON.stringify(tag + token));
      position += token.length;
      copiedUntil = position;
    } else position++;
  }
  parts.push(text.slice(copiedUntil));
  let parsed: unknown;
  try { parsed = JSON.parse(parts.join("")) as unknown; } catch { return invalid(); }

  // Iterate only the parsed input, never objects returned by the caller. Keeping
  // native object creation also preserves __proto__ keys and duplicate-key rules.
  const root: Record<string, unknown> = { "": parsed };
  const stack: { holder: Record<string, unknown>; key: string }[] = [{ holder: root, key: "" }];
  while (stack.length) {
    const { holder, key } = stack.pop()!, value = holder[key];
    if (typeof value === "string" && value.startsWith(tag)) holder[key] = number(key, value.slice(tag.length));
    else if (value !== null && typeof value === "object") {
      const keys = Object.keys(value);
      for (let index = keys.length - 1; index >= 0; index--) stack.push({ holder: value as Record<string, unknown>, key: keys[index]! });
    }
  }
  return root[""];
}

/** Decimal identity without converting the source coefficient or exponent to a double. */
function decimalIdentity(source: string): string {
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/u.exec(source)!;
  const digits = (match[2]! + (match[3] ?? "")).replace(/^0+/u, "");
  if (!digits) return "0";
  const trailing = /0*$/u.exec(digits)![0].length;
  const exponent = match[4] ?? "0", magnitude = exponent.replace(/^[+-]?0*/u, "") || "0";
  const power = BigInt(magnitude) * (exponent.startsWith("-") ? -1n : 1n)
    - BigInt(match[3]?.length ?? 0) + BigInt(trailing);
  return `${match[1]}${digits.slice(0, digits.length - trailing)}e${power}`;
}

/** For owners whose target JSON uses native numbers. Accept only numbers whose
 * decimal value survives native JSON serialization; strings keep their types.
 * Native integers must also have the exact source value: shortest double spelling
 * alone can disguise integer rounding (1000000000000000100 becomes ...0128).
 * Other owners can retain arbitrary precision with parseSourceJson callbacks.
 */
export function parseRoundTripSourceJson(text: string): unknown {
  return parseSourceJson(text, (_key, source) => {
    const value = Number(source);
    const invalid = (): never => { throw new RangeError("IMPORT_SOURCE_JSON_NUMBER_UNREPRESENTABLE"); };
    if (!Number.isFinite(value) || Object.is(value, -0)) return invalid();
    const exact = decimalIdentity(source);
    if (exact !== decimalIdentity(JSON.stringify(value))) return invalid();
    if (Number.isInteger(value) && exact !== decimalIdentity(BigInt(value).toString())) return invalid();
    return value;
  });
}
