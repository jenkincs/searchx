# SearchX release checklist

## Local release candidate

```sh
npm ci
npm run format:check
npm test
npm run benchmark
npm run test:integration
npm run test:multi
npm audit --omit=dev --audit-level=high
npm run package
```

Install the generated VSIX from the VS Code Extensions view, or use:

```sh
code --install-extension searchx-0.0.1.vsix
```

## Public Marketplace release

1. Create or select the Marketplace publisher matching `package.json`.
2. Add the final public repository URL to `package.json`.
3. Run the GitHub Actions matrix on Linux, macOS, and Windows and wait for all jobs to pass.
4. Authenticate `vsce` with the publisher token.
5. Run `npx vsce publish` from the release commit.
6. Install the Marketplace artifact in a clean VS Code profile and repeat the smoke tests.

The Marketplace publisher account and token are intentionally not stored in this repository.
