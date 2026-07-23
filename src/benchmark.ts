import { SearchEngine } from "./searchEngine";

const paths = Array.from(
  { length: 100_000 },
  (_, i) =>
    `file:///workspace/packages/pkg-${i % 500}/src/components/Feature${i}/index.ts`,
);
const rssBefore = process.memoryUsage().rss;
const buildStart = performance.now();
const engine = new SearchEngine(paths);
const buildMs = performance.now() - buildStart;
const rssDeltaMb = (process.memoryUsage().rss - rssBefore) / 1024 / 1024;
console.log(
  `index build: ${buildMs.toFixed(1)} ms, RSS delta=${rssDeltaMb.toFixed(1)} MB`,
);
const queries = [
  "Feature9999",
  "components Feature42",
  "pkg-123",
  "index.ts",
  "components",
  "src/comp",
];
let failed = buildMs > 15_000 || rssDeltaMb > 220;
for (const query of queries) {
  for (let i = 0; i < 5; i++) engine.search(query, 20);
  const timings: number[] = [];
  let result = engine.search(query, 20);
  for (let i = 0; i < 50; i++) {
    const start = performance.now();
    result = engine.search(query, 20);
    timings.push(performance.now() - start);
  }
  timings.sort((a, b) => a - b);
  const p50 = timings[Math.floor(timings.length * 0.5)];
  const p95 = timings[Math.floor(timings.length * 0.95)];
  console.log(
    `${query}: p50=${p50.toFixed(3)} ms p95=${p95.toFixed(3)} ms (${result.length} results)`,
  );
  if (p95 > 10) failed = true;
}
if (failed) {
  console.error(
    "Performance budget failed: build <= 15s, RSS delta <= 220MB, query P95 <= 10ms.",
  );
  process.exitCode = 1;
}
