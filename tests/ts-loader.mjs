import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { stripTypeScriptTypes } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const connectionUrl = pathToFileURL(path.join(root, 'src/database/connection.ts')).href;
const stubMap = new Map([
  ['next/server', pathToFileURL(path.join(root, 'tests/stubs/next-server.mjs')).href],
  ['zod', pathToFileURL(path.join(root, 'tests/stubs/zod.mjs')).href],
  ['@/lib/session', pathToFileURL(path.join(root, 'tests/stubs/session.mjs')).href],
]);

export async function resolve(specifier, context, nextResolve) {
  if (stubMap.has(specifier)) {
    return { url: stubMap.get(specifier), shortCircuit: true };
  }
  if (specifier.startsWith('@/')) {
    const rel = specifier.slice(2);
    const file = path.join(root, 'src', rel);
    return { url: pathToFileURL(path.extname(file) ? file : `${file}.ts`).href, shortCircuit: true };
  }
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && !path.extname(specifier) && context.parentURL?.endsWith('.ts')) {
    return { url: new URL(`${specifier}.ts`, context.parentURL).href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url.endsWith('.ts')) {
    let source = await readFile(fileURLToPath(url), 'utf8');
    if (url === connectionUrl) {
      source = source
        .replace('require("./schema");', '/* test loader: schema imported explicitly */')
        .replace('require("./seed-admin");', '/* test loader: admin seed not required */');
    }
    return {
      format: 'module',
      source: stripTypeScriptTypes(source, { mode: 'transform', sourceMap: false }),
      shortCircuit: true,
    };
  }
  return nextLoad(url, context);
}
