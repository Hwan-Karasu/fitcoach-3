import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { validateModuleImport } from "./module-boundary-rules.ts";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mobileRoot = path.join(projectRoot, "apps", "mobile");
const srcRoot = path.join(mobileRoot, "src");
const files = [
  path.join(mobileRoot, "App.tsx"),
  path.join(mobileRoot, "index.ts"),
  ...await collectTypeScript(srcRoot),
].sort();
const fileSet = new Set(files);
const edges = new Map<string, string[]>();
const errors: string[] = [];

for (const file of files) {
  const contents = await readFile(file, "utf8");
  const syntax = ts.createSourceFile(file, contents, ts.ScriptTarget.Latest, true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const targets: string[] = [];
  for (const specifier of importSpecifiers(syntax)) {
    // Картинки — листья графа без правил границ; достаточно, что файл существует.
    if (/\.(png|jpe?g|webp|json)$/u.test(specifier) && specifier.startsWith(".")) {
      if (!existsSync(path.resolve(path.dirname(file), specifier))) {
        errors.push(`${relative(file)} → ${specifier}: UNRESOLVED_LOCAL_IMPORT`);
      }
      continue;
    }
    const target = specifier.startsWith(".") ? resolveImport(file, specifier, fileSet) : null;
    if (specifier.startsWith(".") && target === null) {
      errors.push(`${relative(file)} → ${specifier}: UNRESOLVED_LOCAL_IMPORT`);
      continue;
    }
    if (target !== null) targets.push(target);
    for (const code of validateModuleImport(relative(file), target === null ? null : relative(target), specifier)) {
      errors.push(`${relative(file)} → ${specifier}: ${code}`);
    }
  }
  edges.set(file, targets);
}

for (const cycle of findCycles(edges)) {
  errors.push(`IMPORT_CYCLE: ${cycle.map(relative).join(" → ")}`);
}

if (errors.length > 0) {
  for (const error of errors) console.error(error);
  process.exitCode = 1;
} else {
  console.log(`Module boundaries OK: ${files.length} TypeScript source files; no forbidden imports or cycles.`);
}

async function collectTypeScript(directory: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await collectTypeScript(absolute));
    else if (entry.isFile() && /\.tsx?$/u.test(entry.name)) result.push(absolute);
  }
  return result;
}

function importSpecifiers(source: ts.SourceFile): string[] {
  const result: string[] = [];
  function visit(node: ts.Node): void {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      result.push(node.moduleSpecifier.text);
    }
    if (ts.isCallExpression(node) && node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0]!) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require"))) {
      result.push(node.arguments[0]!.text);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return result;
}

function resolveImport(from: string, specifier: string, knownFiles: ReadonlySet<string>): string | null {
  const base = path.resolve(path.dirname(from), specifier);
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
    if (knownFiles.has(candidate)) return candidate;
  }
  return null;
}

function relative(file: string): string {
  return path.relative(projectRoot, file).replaceAll(path.sep, "/");
}

function findCycles(graph: ReadonlyMap<string, readonly string[]>): string[][] {
  const state = new Map<string, "visiting" | "visited">();
  const stack: string[] = [];
  const cycles: string[][] = [];
  const seen = new Set<string>();
  function visit(file: string): void {
    if (state.get(file) === "visited") return;
    if (state.get(file) === "visiting") {
      const start = stack.indexOf(file);
      if (start >= 0) {
        const cycle = [...stack.slice(start), file];
        const key = cycle.join("|");
        if (!seen.has(key)) { seen.add(key); cycles.push(cycle); }
      }
      return;
    }
    state.set(file, "visiting");
    stack.push(file);
    for (const target of graph.get(file) ?? []) visit(target);
    stack.pop();
    state.set(file, "visited");
  }
  for (const file of graph.keys()) visit(file);
  return cycles;
}
