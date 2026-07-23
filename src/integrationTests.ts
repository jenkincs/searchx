import * as assert from "node:assert/strict";
import * as vscode from "vscode";
import { suite, test } from "mocha";

async function waitFor(check: () => Promise<boolean>, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.fail("Timed out waiting for SearchX index update");
}

async function status() {
  return await vscode.commands.executeCommand<{ indexedFiles: number }>(
    "searchx.status",
  );
}

suite("SearchX VS Code integration", () => {
  test("activates and registers its public commands", async () => {
    const extension = vscode.extensions.getExtension("searchx.searchx");
    assert.ok(extension, "SearchX extension is not installed in the test host");
    await extension.activate();
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes("searchx.open"));
    assert.ok(commands.includes("searchx.rebuild"));
    assert.ok(commands.includes("searchx.status"));
  });

  test("rebuild applies default excludes", async () => {
    await vscode.commands.executeCommand("searchx.rebuild");
    const files = await vscode.workspace.findFiles(
      "**/*.ts",
      "**/node_modules/**",
    );
    assert.ok(files.some((file) => file.path.endsWith("FeaturePanel.ts")));
    assert.equal((await status()).indexedFiles, files.length);
    if (process.env.SEARCHX_TEST_WORKSPACE) {
      assert.equal(vscode.workspace.workspaceFolders?.length, 2);
      assert.ok(files.some((file) => file.path.endsWith("OtherRoot.ts")));
    }
  });

  test("file watcher incrementally persists create and delete events", async () => {
    const workspace = vscode.workspace.workspaceFolders?.[0];
    assert.ok(workspace);
    const before = (await status()).indexedFiles;
    const file = vscode.Uri.joinPath(
      workspace.uri,
      `src/LiveAdded-${Date.now()}.ts`,
    );
    await vscode.workspace.fs.writeFile(
      file,
      Buffer.from("export const live = true;"),
    );
    try {
      await waitFor(async () => (await status()).indexedFiles === before + 1);
    } finally {
      try {
        await vscode.workspace.fs.delete(file);
      } catch {
        /* already removed */
      }
    }
    await waitFor(async () => (await status()).indexedFiles === before);
  });
});
