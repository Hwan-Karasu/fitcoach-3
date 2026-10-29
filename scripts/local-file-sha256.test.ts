import assert from "node:assert/strict";
import test from "node:test";
import { createHash, randomBytes } from "node:crypto";
import { HASH_READ_BYTES, localFileSha256, LocalFileHashError, type LocalByteFile, type LocalByteReader } from "../apps/mobile/src/shared/files/LocalFileSha256.ts";

function fixture(bytes: Uint8Array) {
  let offset = 0; let closes = 0; let peak = 0;
  const reader: LocalByteReader = {
    get size() { return bytes.length; },
    readBytes(length) { peak = Math.max(peak, length); const result = bytes.subarray(offset, offset + length); offset += result.length; return result; },
    close() { closes++; },
  };
  const file: LocalByteFile = { openReader: () => reader };
  return { file, reader, get peak() { return peak; }, get closes() { return closes; } };
}
for (const size of [0, 1, 63, 64, 65, HASH_READ_BYTES, HASH_READ_BYTES + 1, 5 * 1024 * 1024 + 7]) {
  test(`R06 portable streaming SHA matches node:crypto for ${size} bytes with bounded reads`, async () => {
    const bytes = randomBytes(size); const f = fixture(bytes); let yields = 0;
    // Подставные часы: каждое обращение — +5 мс. Бюджет 8 мс исчерпывается за два куска, значит поток уступается каждые 2 куска.
    let clock = 0;
    const result = await localFileSha256(f.file, async () => { yields++; }, () => (clock += 5));
    assert.deepEqual(result, { sha256: createHash("sha256").update(bytes).digest("hex"), bytes: size });
    assert.ok(f.peak <= HASH_READ_BYTES); assert.equal(f.closes, 1);
    const chunks = Math.ceil(size / HASH_READ_BYTES);
    assert.ok(yields >= Math.floor(chunks / 2) - 1, "поток уступается по времени, а не раз в 4 МБ");
  });
}

test("AUTO-BACKUP-1 известный вектор: SHA-256 «abc»", async () => {
  const result = await localFileSha256(fixture(new TextEncoder().encode("abc")).file, async () => undefined);
  assert.deepEqual(result, { sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", bytes: 3 });
});

test("AUTO-BACKUP-1 при быстрой работе поток не уступается лишний раз (бюджет не исчерпан)", async () => {
  let yields = 0;
  await localFileSha256(fixture(randomBytes(HASH_READ_BYTES * 4)).file, async () => { yields++; }, () => 0);
  assert.equal(yields, 0);
});
for (const kind of ["open", "read", "truncated", "oversized", "size changed", "growth", "close"] as const) {
  test(`R06 file hash ${kind} fails with content-free code and closes the handle`, async () => {
    const f = fixture(new Uint8Array(64));
    if (kind === "open") f.file.openReader = () => { throw new Error("private path"); };
    if (kind === "read") f.reader.readBytes = () => { throw new Error("private path"); };
    if (kind === "truncated") f.reader.readBytes = () => new Uint8Array(0);
    if (kind === "oversized") f.reader.readBytes = (size) => new Uint8Array(size + 1);
    if (kind === "size changed") {
      let reads = 0;
      Object.defineProperty(f.reader, "size", { get: () => reads++ === 0 ? 64 : 65 });
    }
    if (kind === "growth") f.reader.readBytes = (size) => new Uint8Array(size);
    if (kind === "close") f.reader.close = () => { throw new Error("private path"); };
    await assert.rejects(localFileSha256(f.file), (error: unknown) => error instanceof LocalFileHashError && error.message === "LOCAL_FILE_HASH_FAILED");
    if (!["open", "close"].includes(kind)) assert.equal(f.closes, 1);
  });
}
