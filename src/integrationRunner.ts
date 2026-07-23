import * as path from "node:path";
import { runTests } from "@vscode/test-electron";

async function main() {
  const extensionDevelopmentPath = process.env.SEARCHX_EXTENSION_PATH
    ? path.resolve(process.env.SEARCHX_EXTENSION_PATH)
    : path.resolve(__dirname, "..");
  const extensionTestsPath = path.resolve(__dirname, "integrationSuite.js");
  const workspace = process.env.SEARCHX_TEST_WORKSPACE
    ? path.resolve(process.env.SEARCHX_TEST_WORKSPACE)
    : path.resolve(__dirname, "../test/fixture");
  await runTests({
    extensionDevelopmentPath,
    extensionTestsPath,
    launchArgs: [workspace],
  });
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
