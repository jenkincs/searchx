import { parentPort } from "node:worker_threads";
import { SearchEngine } from "./searchEngine";

if (!parentPort) throw new Error("SearchX worker must run in a worker thread");

let engine = new SearchEngine([]);
let ids = new Map<string, number>();

parentPort.on(
  "message",
  (message: {
    type: "init" | "update" | "search";
    id: number;
    paths?: string[];
    added?: string[];
    removed?: string[];
    query?: string;
    limit?: number;
  }) => {
    if (message.type === "init") {
      engine = new SearchEngine(message.paths ?? []);
      ids = new Map(
        (message.paths ?? []).map((filePath, id) => [filePath, id]),
      );
      parentPort?.postMessage({
        type: "ready",
        id: message.id,
        count: engine.paths.length,
      });
    } else if (message.type === "update") {
      for (const filePath of message.removed ?? []) {
        const id = ids.get(filePath);
        if (id !== undefined) engine.removePath(id);
      }
      for (const filePath of message.added ?? [])
        ids.set(filePath, engine.addPath(filePath));
      if (engine.inactiveCount > Math.max(1000, engine.paths.length / 4)) {
        const activePaths = engine.getActivePaths();
        engine = new SearchEngine(activePaths);
        ids = new Map(activePaths.map((filePath, id) => [filePath, id]));
      }
      parentPort?.postMessage({ type: "updated", id: message.id });
    } else {
      parentPort?.postMessage({
        type: "result",
        id: message.id,
        results: engine.search(message.query ?? "", message.limit ?? 100),
      });
    }
  },
);
