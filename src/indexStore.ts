import * as fs from "node:fs/promises";
import * as path from "node:path";
import { deserialize, serialize } from "node:v8";
import { Worker } from "node:worker_threads";
import * as vscode from "vscode";
import type { SearchResult } from "./searchEngine";
import { globMatches } from "./pathFilters";

export class IndexStore {
  private paths = new Set<string>();
  private worker: Worker | undefined;
  private requestId = 0;
  private readonly pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  private saveTimer: NodeJS.Timeout | undefined;
  private saveChain: Promise<void> = Promise.resolve();
  private readonly pendingAdded = new Set<string>();
  private readonly pendingRemoved = new Set<string>();
  private ready: Promise<void> = Promise.resolve();

  constructor(private readonly context: vscode.ExtensionContext) {}

  start() {
    this.ready = this.loadOrBuild();
    return this.ready;
  }

  whenReady() {
    return this.ready;
  }

  status() {
    return { indexedFiles: this.paths.size, indexFile: this.indexFile() };
  }

  async search(query: string, limit: number): Promise<SearchResult[]> {
    await this.ready;
    if (!this.worker) return [];
    return this.request<SearchResult[]>({ type: "search", query, limit });
  }

  async loadOrBuild(): Promise<void> {
    const file = this.indexFile();
    let restored = false;
    try {
      const data = deserialize(await fs.readFile(file)) as {
        version: number;
        paths: string[];
      };
      if (data.version !== 1 || !Array.isArray(data.paths))
        throw new Error("Unsupported SearchX index");
      this.paths = new Set(data.paths);
      restored = true;
    } catch {
      // Read the early JSON format once so existing development indexes migrate
      // without forcing a full scan.
      try {
        const legacy = JSON.parse(
          await fs.readFile(this.legacyIndexFile(), "utf8"),
        ) as { paths: string[] };
        this.paths = new Set(legacy.paths);
        await this.save();
      } catch {
        await this.rebuild();
      }
    }
    await this.startWorker();
    if (restored)
      void this.reconcile().catch((error) =>
        console.error("SearchX index reconciliation failed", error),
      );
  }

  async rebuild(): Promise<void> {
    const exclude = this.excludePattern();
    const uris = await vscode.workspace.findFiles("**/*", exclude);
    this.paths = new Set(uris.map((uri) => uri.toString()));
    if (this.worker) await this.startWorker();
    await this.save();
  }

  async update(uri: vscode.Uri, exists: boolean) {
    if (exists) {
      if (this.isExcluded(uri)) return;
      try {
        const stat = await vscode.workspace.fs.stat(uri);
        if (stat.type !== vscode.FileType.File) return;
      } catch {
        return;
      }
    }
    const key = uri.toString();
    if (exists) {
      this.paths.add(key);
      this.pendingRemoved.delete(key);
      this.pendingAdded.add(key);
    } else {
      this.paths.delete(key);
      this.pendingAdded.delete(key);
      this.pendingRemoved.add(key);
    }
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      const added = [...this.pendingAdded];
      const removed = [...this.pendingRemoved];
      this.pendingAdded.clear();
      this.pendingRemoved.clear();
      void (
        this.worker ? this.applyDelta(added, removed) : this.startWorker()
      ).catch((error) => console.error("SearchX index update failed", error));
      void this.save().catch((error) =>
        console.error("SearchX index save failed", error),
      );
    }, 500);
  }

  dispose() {
    clearTimeout(this.saveTimer);
    this.pendingAdded.clear();
    this.pendingRemoved.clear();
    for (const request of this.pending.values()) request.resolve([]);
    this.pending.clear();
    void this.worker?.terminate();
  }

  private async startWorker() {
    if (!this.worker) {
      this.worker = new Worker(path.join(__dirname, "searchWorker.js"));
      this.worker.on("message", (message) => {
        if (
          message.type === "ready" ||
          message.type === "updated" ||
          message.type === "result"
        ) {
          const request = this.pending.get(message.id);
          if (!request) return;
          this.pending.delete(message.id);
          request.resolve(
            message.type === "result" ? message.results : undefined,
          );
        }
      });
      this.worker.on("error", (error) => {
        console.error("SearchX worker failed", error);
        for (const request of this.pending.values())
          request.reject(
            error instanceof Error ? error : new Error(String(error)),
          );
        this.pending.clear();
        this.worker = undefined;
      });
    }
    await this.request<void>({ type: "init", paths: [...this.paths].sort() });
  }

  private applyDelta(added: string[], removed: string[]) {
    if (added.length === 0 && removed.length === 0) return Promise.resolve();
    return this.request<void>({ type: "update", added, removed });
  }

  private request<T>(message: {
    type: "init" | "update" | "search";
    query?: string;
    limit?: number;
    paths?: string[];
    added?: string[];
    removed?: string[];
  }): Promise<T> {
    const id = ++this.requestId;
    return new Promise((resolve, reject) => {
      if (!this.worker) {
        reject(new Error("SearchX worker is not running"));
        return;
      }
      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
      });
      this.worker.postMessage({ ...message, id });
    });
  }

  private async save() {
    const operation = this.saveChain.then(async () => {
      const file = this.indexFile();
      await fs.mkdir(path.dirname(file), { recursive: true });
      const temp = `${file}.${process.pid}.tmp`;
      await fs.writeFile(
        temp,
        serialize({ version: 1, paths: [...this.paths] }),
      );
      await fs.rename(temp, file);
    });
    this.saveChain = operation.catch(() => undefined);
    return operation;
  }

  private async reconcile() {
    const current = new Set(
      (await vscode.workspace.findFiles("**/*", this.excludePattern())).map(
        (uri) => uri.toString(),
      ),
    );
    const indexed = new Set(this.paths);
    const added = [...current].filter((filePath) => !indexed.has(filePath));
    const removed = [...indexed].filter((filePath) => !current.has(filePath));
    if (added.length === 0 && removed.length === 0) return;
    for (const filePath of added) this.paths.add(filePath);
    for (const filePath of removed) this.paths.delete(filePath);
    await this.applyDelta(added, removed);
    await this.save();
  }

  private indexFile() {
    return path.join(
      this.context.storageUri?.fsPath ?? this.context.globalStorageUri.fsPath,
      "index.bin",
    );
  }
  private legacyIndexFile() {
    return path.join(
      this.context.storageUri?.fsPath ?? this.context.globalStorageUri.fsPath,
      "index.json",
    );
  }
  private excludePatterns() {
    const searchx = vscode.workspace
      .getConfiguration("searchx")
      .get<string[]>("exclude", []);
    const filesExclude = vscode.workspace
      .getConfiguration("files")
      .get<Record<string, boolean>>("exclude", {});
    const searchExclude = vscode.workspace
      .getConfiguration("search")
      .get<Record<string, boolean>>("exclude", {});
    return [
      ...searchx,
      ...Object.keys(filesExclude).filter((pattern) => filesExclude[pattern]),
      ...Object.keys(searchExclude).filter((pattern) => searchExclude[pattern]),
    ];
  }
  private excludePattern() {
    const patterns = this.excludePatterns();
    return patterns.length ? `{${patterns.join(",")}}` : undefined;
  }

  private isExcluded(uri: vscode.Uri) {
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    if (!folder) return false;
    const relative = path
      .relative(folder.uri.fsPath, uri.fsPath)
      .replaceAll(path.sep, "/");
    return this.excludePatterns().some((pattern) =>
      globMatches(pattern, relative),
    );
  }
}
