import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return /\.(ts|tsx|js|jsx|json|md)$/.test(entry.name) ? [full] : [];
  });
}

test("homepage address uses 경원빌딩, never 경원빌딘", () => {
  const files = walk(path.join(root, "src"));
  const matches = files.filter((file) => fs.readFileSync(file, "utf8").includes("경원빌딘"));
  assert.deepEqual(matches, []);
});
