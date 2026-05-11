import * as vscode from 'vscode';

interface GitAPI {
  repositories: GitRepository[];
}
interface GitRepository {
  rootUri: vscode.Uri;
  show(ref: string, path: string): Promise<string>;
}

/**
 * Result of trying to read the HEAD version of a file.
 * Always succeeds in returning structured info — never throws.
 *
 *   found = true:   `content` and `repoRoot` are set
 *   found = false:  `reason` explains exactly why; UI surfaces it to the user.
 */
export interface GitLookupResult {
  found: boolean;
  content?: string;
  reason?: string;
  repoRoot?: string;
}

/**
 * Normalize a path for case/slash-insensitive comparison.
 * Windows paths can come with mixed slashes and casing depending on the source
 * (vs.workspace.asRelativePath, uri.fsPath, repo.rootUri.fsPath all behave
 *  slightly differently). This makes prefix matching reliable.
 */
function normalize(p: string): string {
  return p.replace(/\\/g, '/').toLowerCase();
}

/**
 * Try to read the HEAD revision of a file from VS Code's built-in Git extension.
 * Returns a structured result — caller surfaces `reason` to the user.
 */
export async function getOriginalFromGit(
  uri: vscode.Uri
): Promise<GitLookupResult> {
  const ext = vscode.extensions.getExtension<any>('vscode.git');
  if (!ext) {
    return {
      found: false,
      reason:
        "VS Code's Git extension is missing or disabled. Enable 'Git' in the Extensions view.",
    };
  }
  if (!ext.isActive) {
    try {
      await ext.activate();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        found: false,
        reason: `Git extension failed to activate: ${msg}`,
      };
    }
  }

  let api: GitAPI;
  try {
    api = ext.exports.getAPI(1);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { found: false, reason: `Git API not available: ${msg}` };
  }
  if (!api?.repositories) {
    return { found: false, reason: 'Git API returned no repositories field' };
  }
  if (api.repositories.length === 0) {
    return {
      found: false,
      reason:
        'No Git repositories detected. Run `git init` and `git add .` and `git commit -m "baseline"` in your project root.',
    };
  }

  const filePath = uri.fsPath;
  const fileNorm = normalize(filePath);
  const repo = api.repositories.find((r) =>
    fileNorm.startsWith(normalize(r.rootUri.fsPath))
  );
  if (!repo) {
    const repoList = api.repositories
      .map((r) => r.rootUri.fsPath)
      .join('  |  ');
    return {
      found: false,
      reason: `File is outside all loaded Git repos.\n  File: ${filePath}\n  Repos: ${repoList}`,
    };
  }

  try {
    const content = await repo.show('HEAD', filePath);
    return {
      found: true,
      content,
      repoRoot: repo.rootUri.fsPath,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Most common cause: file not tracked yet
    let hint =
      ' Run `git add <file>` and `git commit` to start tracking it.';
    if (/onedrive/i.test(filePath)) {
      hint +=
        ' Note: this file is in OneDrive — if it shows as cloud-only (no green checkmark), right-click it in Explorer and choose "Always keep on this device".';
    }
    return {
      found: false,
      reason: `Cannot read HEAD revision: ${msg}.${hint}`,
      repoRoot: repo.rootUri.fsPath,
    };
  }
}

/**
 * Comprehensive diagnostic — checks every step and returns a multi-line report.
 * Used by the "Diagnose Git" command.
 */
export async function diagnoseGit(
  activeUri: vscode.Uri | undefined
): Promise<string> {
  const lines: string[] = [];
  lines.push('=== Git diagnostic ===');

  const ext = vscode.extensions.getExtension<any>('vscode.git');
  lines.push(`Git extension installed: ${ext ? 'YES' : 'NO'}`);
  if (!ext) {
    lines.push(
      '  Fix: Open Extensions panel (Ctrl+Shift+X), search "@builtin Git", make sure it is enabled.'
    );
    return lines.join('\n');
  }
  lines.push(`Git extension active: ${ext.isActive ? 'YES' : 'NO (activating...)'}`);
  if (!ext.isActive) {
    try {
      await ext.activate();
    } catch (err) {
      lines.push(`  ERROR activating: ${err}`);
      return lines.join('\n');
    }
  }

  let api: GitAPI;
  try {
    api = ext.exports.getAPI(1);
  } catch (err) {
    lines.push(`Git API call failed: ${err}`);
    return lines.join('\n');
  }
  const repos = api?.repositories ?? [];
  lines.push(`Repositories loaded: ${repos.length}`);
  for (const r of repos) {
    lines.push(`  - ${r.rootUri.fsPath}`);
  }

  if (repos.length === 0) {
    lines.push(
      'Fix: open a terminal in your project root and run:'
    );
    lines.push('  git init');
    lines.push('  git add .');
    lines.push('  git commit -m "baseline"');
    return lines.join('\n');
  }

  if (!activeUri) {
    lines.push('No active editor file to test against.');
    lines.push('Open a .verse or .py file you want to review and run this again.');
    return lines.join('\n');
  }

  const fp = activeUri.fsPath;
  lines.push(`Active file: ${fp}`);
  if (/onedrive/i.test(fp)) {
    lines.push(
      '  WARNING: file is in OneDrive. If it shows as cloud-only (gray icon, no green check), Git can read a placeholder instead of real content. Right-click in Explorer → "Always keep on this device".'
    );
  }

  const fileNorm = normalize(fp);
  const repo = repos.find((r) => fileNorm.startsWith(normalize(r.rootUri.fsPath)));
  if (!repo) {
    lines.push('Match against loaded repos: NO MATCH');
    lines.push(
      '  Fix: the file is not inside any loaded Git repo. Either:'
    );
    lines.push('    a) Run `git init` in this file\'s parent project root.');
    lines.push(
      '    b) Move/copy your project into an existing repo from the list above.'
    );
    return lines.join('\n');
  }
  lines.push(`Matched repo: ${repo.rootUri.fsPath}`);

  try {
    const content = await repo.show('HEAD', fp);
    lines.push(
      `repo.show('HEAD', file) succeeded — ${content.length} chars read.`
    );
    lines.push('Git is working for this file. ✓');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    lines.push(`repo.show('HEAD', file) FAILED: ${msg}`);
    lines.push('  Most likely cause: the file is not tracked yet. Fix:');
    lines.push('    git add <relative path of the file>');
    lines.push('    git commit -m "track this file"');
    lines.push(
      '  Verify with: `git ls-files <relative path>` — should print the path.'
    );
  }

  return lines.join('\n');
}
