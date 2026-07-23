import assert from "node:assert/strict";
import test from "node:test";
import { SearchEngine } from "./searchEngine";

const paths = [
  "file:///workspace/src/components/FeaturePanel.ts",
  "file:///workspace/src/components/FeatureCard.ts",
  "file:///workspace/test/FeaturePanel.test.ts",
  "file:///workspace/src/index.ts",
];

test("matches exact basenames before path fragments", () => {
  const result = new SearchEngine(paths).search("FeaturePanel", 10);
  assert.ok(result.some((item) => item.path === paths[0]));
});

test("intersects multiple path tokens", () => {
  const result = new SearchEngine(paths).search("components FeatureCard", 10);
  assert.deepEqual(
    result.map((item) => item.path),
    [paths[1]],
  );
});

test("finds common exact basenames without scanning all results", () => {
  const many = Array.from(
    { length: 100_000 },
    (_, i) => `file:///workspace/pkg-${i}/index.ts`,
  );
  const engine = new SearchEngine(many);
  const start = performance.now();
  const result = engine.search("index.ts", 20);
  const elapsed = performance.now() - start;
  assert.equal(result.length, 20);
  assert.ok(elapsed < 25, `search took ${elapsed.toFixed(2)}ms`);
});

test("returns no result for a missing trigram", () => {
  assert.deepEqual(new SearchEngine(paths).search("zzzzzz", 10), []);
});

test("adds and removes paths without rebuilding the engine", () => {
  const engine = new SearchEngine(paths);
  const added = "file:///workspace/src/new/InstantResult.ts";
  const id = engine.addPath(added);
  assert.equal(engine.search("InstantResult", 10)[0].path, added);
  engine.removePath(id);
  assert.deepEqual(engine.search("InstantResult", 10), []);
});
