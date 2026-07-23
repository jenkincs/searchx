import assert from "node:assert/strict";
import { Worker } from "node:worker_threads";
import test from "node:test";
import * as path from "node:path";

test("worker initializes and serves a search request", async () => {
  const worker = new Worker(path.join(__dirname, "searchWorker.js"));
  try {
    const response = await new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("worker timeout")), 3000);
      worker.on("error", reject);
      worker.on("message", (message) => {
        if (message.type === "ready")
          worker.postMessage({
            type: "update",
            id: 2,
            added: ["file:///workspace/src/InstantResult.ts"],
            removed: ["file:///workspace/src/FeaturePanel.ts"],
          });
        if (message.type === "updated")
          worker.postMessage({
            type: "search",
            id: 3,
            query: "InstantResult",
            limit: 10,
          });
        if (message.type === "result") {
          clearTimeout(timer);
          resolve(message);
        }
      });
      worker.postMessage({
        type: "init",
        id: 1,
        paths: ["file:///workspace/src/FeaturePanel.ts"],
      });
    });
    assert.equal(response.results.length, 1);
    assert.equal(
      response.results[0].path,
      "file:///workspace/src/InstantResult.ts",
    );
  } finally {
    await worker.terminate();
  }
});
