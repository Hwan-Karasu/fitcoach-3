import { execFileSync, spawn } from "node:child_process";
import { get } from "node:http";
import { dirname, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const projectDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const port = 8081;
const address = `127.0.0.1:${port}`;

function onlineDevice(): string {
  const rows = execFileSync("adb", ["devices"], { encoding: "utf8" }).split(/\r?\n/u);
  const serials = rows.flatMap((row) => {
    const match = /^([^\s]+)\s+device\s*$/u.exec(row);
    return match?.[1] ? [match[1]] : [];
  });
  if (serials.length !== 1 || !serials[0]) {
    throw new Error(`Нужен ровно один Android device online; найдено: ${serials.length}`);
  }
  return serials[0];
}

async function metroReady(): Promise<boolean> {
  return await new Promise<boolean>((done) => {
    const request = get(`http://${address}/status`, (response) => {
      response.resume();
      done(response.statusCode === 200);
    });
    request.setTimeout(1000, () => request.destroy());
    request.on("error", () => done(false));
  });
}

async function main(): Promise<void> {
  const serial = onlineDevice();
  if (await metroReady()) {
    throw new Error(`Порт ${port} уже занят. Остановите прежний Metro и повторите запуск.`);
  }
  execFileSync("adb", ["-s", serial, "reverse", `tcp:${port}`, `tcp:${port}`], {
    stdio: "inherit",
  });

  console.info("Запускается только тестовый R07 SQLite spike, не FitCoach UI.");
  const child = spawn(
    process.execPath,
    [resolve(projectDir, "node_modules/expo/bin/cli"), "start", "--localhost", "--port", String(port)],
    {
      cwd: projectDir,
      stdio: "inherit",
      env: {
        ...process.env,
        NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --dns-result-order=ipv4first`.trim(),
      },
    },
  );
  const stopped = new Promise<void>((done) => child.once("exit", () => done()));

  for (let attempt = 0; attempt < 90; attempt += 1) {
    if (await metroReady()) {
      execFileSync(
        "adb",
        ["-s", serial, "shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", `exp://${address}`, "host.exp.exponent"],
        { stdio: "inherit" },
      );
      console.info("Expo Go открыт. Нажмите «Запустить проверки» на экране R07.");
      await stopped;
      return;
    }
    if (child.exitCode !== null) throw new Error(`Metro завершился с кодом ${child.exitCode}`);
    await delay(1000);
  }
  child.kill();
  throw new Error("Metro не открыл порт 8081 за 90 секунд");
}

await main();
