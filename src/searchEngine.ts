export interface SearchResult {
  id: number;
  path: string;
  score: number;
}

const normalize = (value: string) => value.toLowerCase().replaceAll("\\", "/");
const tokens = (value: string) =>
  normalize(value)
    .split(/[^a-z0-9\u0080-\uffff]+/i)
    .filter(Boolean);

/** In-memory index. It intentionally stores sorted integer postings, not strings. */
export class SearchEngine {
  private readonly tokenPostings = new Map<string, number[]>();
  private readonly trigramPostings = new Map<string, number[]>();
  private readonly basenamePostings = new Map<string, number[]>();
  private readonly normalizedPaths: string[] = [];
  private readonly active: boolean[] = [];
  private readonly pathIds = new Map<string, number>();
  private inactive = 0;

  public readonly paths: string[];

  constructor(paths: string[]) {
    // Keep an owned array: addPath/removePath must never mutate the caller's
    // array, and all initial entries must receive active=true state.
    this.paths = [];
    for (const filePath of paths) this.appendPath(filePath);
  }

  addPath(filePath: string): number {
    const existing = this.pathIds.get(filePath);
    if (existing !== undefined) {
      if (!this.active[existing]) {
        this.active[existing] = true;
        this.inactive--;
      }
      return existing;
    }
    return this.appendPath(filePath);
  }

  removePath(id: number) {
    if (id >= 0 && id < this.active.length && this.active[id]) {
      this.active[id] = false;
      this.inactive++;
    }
  }

  get inactiveCount() {
    return this.inactive;
  }

  getActivePaths() {
    return this.paths.filter((_, id) => this.active[id]);
  }

  search(query: string, limit = 100): SearchResult[] {
    const q = normalize(query).trim();
    if (!q) return [];
    limit = Math.max(1, Math.min(1000, Math.floor(limit)));
    const queryParts = tokens(q);
    const exactBasenames = this.basenamePostings.get(q);
    // Exact file names are common (for example index.ts). Their score is already
    // maximal, so avoid scanning and sorting every matching directory.
    const rawCandidates = exactBasenames
      ? this.firstActive(exactBasenames, limit)
      : this.candidates(q, queryParts, Math.max(limit * 20, 500));
    const candidateIds =
      rawCandidates.length > Math.max(limit * 20, 500)
        ? rawCandidates.slice(0, Math.max(limit * 20, 500))
        : rawCandidates;
    const results: SearchResult[] = [];
    for (const id of candidateIds) {
      if (!this.active[id]) continue;
      const path = this.normalizedPaths[id];
      const base = path.slice(path.lastIndexOf("/") + 1);
      let score = 0;
      if (base === q) score += 1000;
      if (base.startsWith(q)) score += 500;
      if (path.includes(q)) score += 200;
      for (const part of queryParts) {
        if (base.includes(part)) score += 80;
        if (path.includes(part)) score += 20;
      }
      score -= path.length / 10000;
      const result = { id, path: this.paths[id], score };
      if (results.length < limit) {
        results.push(result);
        this.siftUp(results, results.length - 1);
      } else if (this.compare(result, results[0]) > 0) {
        results[0] = result;
        this.siftDown(results, 0);
      }
    }
    return results.sort((a, b) => -this.compare(a, b));
  }

  private candidates(
    q: string,
    queryTokens: string[],
    maxCandidates: number,
  ): number[] {
    const postings = queryTokens
      .map((t) => this.tokenPostings.get(t))
      .filter((x): x is number[] => !!x);
    if (postings.length === queryTokens.length && postings.length > 0)
      return this.intersect(postings);
    if (q.length >= 3) {
      const grams = this.ngrams(q)
        .map((g) => this.trigramPostings.get(g))
        .filter((x): x is number[] => !!x);
      if (grams.length > 0) return this.intersect(grams);
      if (q.includes("/")) return this.scanPath(q, maxCandidates);
      return [];
    }
    // Short queries are uncommon and scanning 100k compact strings is still cheap.
    return this.scanPath(q, maxCandidates);
  }

  private scanPath(q: string, maxCandidates: number) {
    const result: number[] = [];
    for (
      let id = 0;
      id < this.normalizedPaths.length && result.length < maxCandidates;
      id++
    ) {
      if (this.active[id] && this.normalizedPaths[id].includes(q))
        result.push(id);
    }
    return result;
  }

  private ngrams(value: string): string[] {
    const compact = value.replaceAll("/", " ");
    const grams: string[] = [];
    for (let i = 0; i + 2 < compact.length; i++)
      grams.push(compact.slice(i, i + 3));
    return [...new Set(grams)];
  }

  private add(map: Map<string, number[]>, key: string, id: number) {
    let list = map.get(key);
    if (!list) map.set(key, (list = []));
    list.push(id);
  }

  private appendPath(filePath: string): number {
    const id = this.paths.length;
    this.paths.push(filePath);
    this.pathIds.set(filePath, id);
    const normalized = normalize(filePath);
    this.normalizedPaths.push(normalized);
    this.active.push(true);
    for (const token of new Set(tokens(normalized)))
      this.add(this.tokenPostings, token, id);
    const basename = normalized.slice(normalized.lastIndexOf("/") + 1);
    for (const gram of this.ngrams(basename))
      this.add(this.trigramPostings, gram, id);
    this.add(this.basenamePostings, basename, id);
    return id;
  }

  private firstActive(ids: number[], limit: number): number[] {
    const result: number[] = [];
    for (const id of ids) {
      if (this.active[id]) result.push(id);
      if (result.length === limit) break;
    }
    return result;
  }

  private intersect(lists: number[][]): number[] {
    lists.sort((a, b) => a.length - b.length);
    let result = lists[0].slice();
    for (let i = 1; i < lists.length && result.length; i++) {
      const next = lists[i];
      const intersection: number[] = [];
      let left = 0;
      let right = 0;
      while (left < result.length && right < next.length) {
        const a = result[left];
        const b = next[right];
        if (a === b) {
          intersection.push(a);
          left++;
          right++;
        } else if (a < b) left++;
        else right++;
      }
      result = intersection;
    }
    return result;
  }

  private compare(a: SearchResult, b: SearchResult): number {
    return (
      a.score - b.score ||
      b.path.length - a.path.length ||
      b.path.localeCompare(a.path)
    );
  }

  private siftUp(heap: SearchResult[], index: number) {
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (this.compare(heap[parent], heap[index]) <= 0) break;
      [heap[parent], heap[index]] = [heap[index], heap[parent]];
      index = parent;
    }
  }

  private siftDown(heap: SearchResult[], index: number) {
    for (;;) {
      const left = index * 2 + 1;
      const right = left + 1;
      let smallest = index;
      if (left < heap.length && this.compare(heap[left], heap[smallest]) < 0)
        smallest = left;
      if (right < heap.length && this.compare(heap[right], heap[smallest]) < 0)
        smallest = right;
      if (smallest === index) return;
      [heap[index], heap[smallest]] = [heap[smallest], heap[index]];
      index = smallest;
    }
  }
}
