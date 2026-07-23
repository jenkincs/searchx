import * as vscode from "vscode";
import { IndexStore } from "./indexStore";

export async function activate(context: vscode.ExtensionContext) {
  const store = new IndexStore(context);
  const recentKey = "searchx.recentFiles";
  const allRecentFiles = () => context.globalState.get<string[]>(recentKey, []);
  const recentFiles = () =>
    allRecentFiles().filter(
      (value) => !!vscode.workspace.getWorkspaceFolder(vscode.Uri.parse(value)),
    );
  const remember = (uri: vscode.Uri) =>
    void context.globalState.update(
      recentKey,
      [
        uri.toString(),
        ...recentFiles().filter((value) => value !== uri.toString()),
      ].slice(0, 50),
    );
  const status = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    10,
  );
  status.text = "$(search) SearchX";
  status.command = "searchx.open";
  status.show();
  context.subscriptions.push(status);

  context.subscriptions.push(
    vscode.commands.registerCommand("searchx.open", async () => {
      const maxResults = vscode.workspace
        .getConfiguration("searchx")
        .get<number>("maxResults", 100);
      const picker = vscode.window.createQuickPick<
        vscode.QuickPickItem & { uri: vscode.Uri }
      >();
      picker.matchOnDescription = false;
      picker.placeholder = "Search files by name or path…";
      let searchGeneration = 0;
      const refresh = async () => {
        const generation = ++searchGeneration;
        if (!picker.value.trim()) {
          picker.busy = false;
          picker.items = recentFiles()
            .slice(0, maxResults)
            .map((value) => {
              const uri = vscode.Uri.parse(value);
              return {
                label: vscode.workspace.asRelativePath(uri),
                description: "Recently opened",
                uri,
              };
            });
          return;
        }
        picker.busy = true;
        const results = await store.search(picker.value, maxResults);
        if (generation !== searchGeneration) return;
        picker.busy = false;
        picker.items = results.map((result) => ({
          label: vscode.workspace.asRelativePath(vscode.Uri.parse(result.path)),
          description: result.path,
          uri: vscode.Uri.parse(result.path),
        }));
      };
      picker.onDidChangeValue(() => void refresh());
      picker.onDidAccept(async () => {
        const item = picker.selectedItems[0];
        if (!item) return;
        try {
          await vscode.window.showTextDocument(
            await vscode.workspace.openTextDocument(item.uri),
          );
          remember(item.uri);
          picker.hide();
        } catch (error) {
          void vscode.window.showErrorMessage(
            `SearchX could not open ${item.label}: ${String(error)}`,
          );
        }
      });
      picker.onDidHide(() => picker.dispose());
      picker.show();
      void refresh();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("searchx.rebuild", async () => {
      await store.whenReady();
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "SearchX: rebuilding index",
        },
        () => store.rebuild(),
      );
      vscode.window.showInformationMessage("SearchX index rebuilt.");
    }),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("searchx.status", async () => {
      await store.whenReady();
      const status = store.status();
      vscode.window.showInformationMessage(
        `SearchX indexed ${status.indexedFiles.toLocaleString()} files.`,
      );
      return status;
    }),
  );

  const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
  const watchers = workspaceFolders.length
    ? workspaceFolders.map((folder) =>
        vscode.workspace.createFileSystemWatcher(
          new vscode.RelativePattern(folder, "**/*"),
        ),
      )
    : [vscode.workspace.createFileSystemWatcher("**/*")];
  for (const watcher of watchers) {
    watcher.onDidCreate((uri) => void store.update(uri, true));
    watcher.onDidDelete((uri) => void store.update(uri, false));
  }
  context.subscriptions.push(...watchers);
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("searchx.exclude")) {
        void vscode.commands.executeCommand("searchx.rebuild");
      }
    }),
  );
  context.subscriptions.push({ dispose: () => store.dispose() });
  void Promise.resolve(
    vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Window,
        title: "SearchX: loading index",
      },
      () => store.start(),
    ),
  ).catch((error: unknown) => {
    console.error("SearchX failed to load its index", error);
    void vscode.window.showWarningMessage(
      "SearchX could not load its index. Run 'SearchX: Rebuild Index' to retry.",
    );
  });
}

export function deactivate() {}
