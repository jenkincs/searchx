import assert from "node:assert/strict";
import test from "node:test";
import { globMatches } from "./pathFilters";

test("exclude globs match root and nested directories", () => {
  assert.equal(
    globMatches("**/node_modules/**", "node_modules/pkg/index.js"),
    true,
  );
  assert.equal(
    globMatches("**/node_modules/**", "packages/app/node_modules/pkg/index.js"),
    true,
  );
  assert.equal(
    globMatches("**/node_modules/**", "packages/app/src/index.ts"),
    false,
  );
});

test("single-star globs do not cross directories", () => {
  assert.equal(globMatches("src/*.ts", "src/index.ts"), true);
  assert.equal(globMatches("src/*.ts", "src/components/index.ts"), false);
});
