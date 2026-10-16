export type SensitiveFinding =
  | "PRIVATE_KEY_FILE"
  | "ENV_FILE"
  | "DATABASE_FILE"
  | "PRIVATE_KEY_HEADER"
  | "AWS_ACCESS_KEY_ID"
  | "GITHUB_TOKEN"
  | "OPENAI_API_KEY";

const privateFile = /\.(?:jks|keystore|pem|p12|pfx|key)$/iu;
const databaseFile = /\.(?:db|db-shm|db-wal|sqlite|sqlite3|atbackup)$/iu;
const patterns: readonly [SensitiveFinding, RegExp][] = [
  ["PRIVATE_KEY_HEADER", /-{5}BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-{5}/u],
  ["AWS_ACCESS_KEY_ID", /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/u],
  ["GITHUB_TOKEN", /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}\b|\bgithub_pat_[A-Za-z0-9_]{82}\b/u],
  ["OPENAI_API_KEY", /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b/u],
];

export function inspectSensitivePath(file: string): readonly SensitiveFinding[] {
  const name = file.replaceAll("\\", "/").split("/").at(-1) ?? "";
  if (name === ".env" || (name.startsWith(".env.") && name !== ".env.example")) {
    return ["ENV_FILE"];
  }
  if (privateFile.test(name)) return ["PRIVATE_KEY_FILE"];
  if (databaseFile.test(name)) return ["DATABASE_FILE"];
  return [];
}

export function inspectSensitiveLine(line: string): readonly SensitiveFinding[] {
  return patterns.filter(([, pattern]) => pattern.test(line)).map(([finding]) => finding);
}
