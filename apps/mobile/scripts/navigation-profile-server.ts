import { createServer } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const output = path.resolve(process.argv[2] ?? "../navigation-profile-captures");
await mkdir(output, { recursive: true });
createServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== "/capture") { response.writeHead(404).end(); return; }
  try {
    let body = "";
    for await (const chunk of request) { body += String(chunk); if (body.length > 1_000_000) throw new Error("CAPTURE_TOO_LARGE"); }
    const capture = JSON.parse(body) as { label: string; samples: { totalMs: number }[] };
    if (!/^[a-z0-9-]+$/u.test(capture.label) || !Array.isArray(capture.samples)) throw new Error("CAPTURE_INVALID");
    const destination = path.join(output, `${capture.label}-${Date.now()}.json`);
    await writeFile(destination, JSON.stringify(capture, null, 2) + "\n", "utf8");
    console.log(JSON.stringify({ file: destination, count: capture.samples.length }));
    response.writeHead(200).end("saved");
  } catch { response.writeHead(400).end("invalid capture"); }
}).listen(8099, "127.0.0.1", () => console.log(`Profile receiver: http://127.0.0.1:8099 -> ${output}`));
