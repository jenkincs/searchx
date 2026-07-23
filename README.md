# SearchX

SearchX is a VS Code extension for fast project-file lookup in very large workspaces.

## Usage

- Press `Cmd+Alt+O` on macOS or `Ctrl+Alt+O` on Windows/Linux.
- Type a file name, directory, or path fragment and press Enter.
- Run `SearchX: Rebuild Index` from the Command Palette after changing exclude rules.
- Run `SearchX: Show Index Status` to see the indexed file count.

The index is persisted in VS Code's extension storage. File create/change/delete events update it incrementally. Search uses integer postings and trigram postings in memory, so the hot path does not touch the filesystem or invoke VS Code's text search.

## Development

```sh
npm install
npm run compile
npm run benchmark
npm run package
```

The benchmark exercises 100,000 synthetic paths and reports warmed-up P50/P95 query latency. It is a smoke benchmark, not a replacement for profiling on a real repository.

The search index is kept in a background Worker. The 100,000-file benchmark is gated at 10ms P95 per query; typical exact filename and token searches are sub-millisecond after warm-up. The first index build is intentionally asynchronous and can take longer because it scans the workspace.

To install a local build, run `npm run package`, then install the generated `searchx-*.vsix` from VS Code's Extensions view.
