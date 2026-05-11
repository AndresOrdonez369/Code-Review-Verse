import * as vscode from 'vscode';

/**
 * Style guide loader — v0.2.8.
 *
 * Returns a structured result that callers can inspect:
 *   - what file was tried (each path attempted)
 *   - whether one was found and where
 *   - the content if found
 *
 * Search order:
 *   1. Each workspace folder root: <folder>/<styleGuidePath setting>
 *   2. Optional global fallback: uefnCodeReview.globalStyleGuidePath setting
 *      (absolute path; lets a team share one canonical guide across projects)
 *
 * The rich return shape powers both the silent inline use (preReview loop)
 * and the explicit `Diagnose Style Guide` command.
 */

export interface StyleGuideResult {
  found: boolean;
  content?: string;
  matchedPath?: string;
  searchedPaths: string[];
  language: string;
  guideName: string;
}

export async function loadStyleGuide(
  language: string,
  fileUri?: vscode.Uri
): Promise<StyleGuideResult> {
  const config = vscode.workspace.getConfiguration('uefnCodeReview');
  const guideName = guideNameForLanguage(language, config);

  const result: StyleGuideResult = {
    found: false,
    searchedPaths: [],
    language,
    guideName: guideName ?? '(no guide configured for this language)',
  };

  if (!guideName) return result;

  // 1. Workspace folders
  const folders = vscode.workspace.workspaceFolders ?? [];
  for (const folder of folders) {
    const uri = vscode.Uri.joinPath(folder.uri, guideName);
    result.searchedPaths.push(uri.fsPath);
    const content = await tryRead(uri);
    if (content !== undefined) {
      result.found = true;
      result.content = content;
      result.matchedPath = uri.fsPath;
      return result;
    }
  }

  // 2. Global fallback path (absolute, optional)
  const globalPath = config.get<string>('globalStyleGuidePath', '').trim();
  if (globalPath) {
    const uri = vscode.Uri.file(globalPath);
    result.searchedPaths.push(uri.fsPath);
    const content = await tryRead(uri);
    if (content !== undefined) {
      result.found = true;
      result.content = content;
      result.matchedPath = uri.fsPath;
      return result;
    }
  }

  return result;
}

function guideNameForLanguage(
  language: string,
  config: vscode.WorkspaceConfiguration
): string | undefined {
  if (language === 'verse') {
    return config.get<string>('styleGuidePath', '.verse-style.md');
  }
  if (language === 'python') {
    return '.python-style.md';
  }
  return undefined;
}

async function tryRead(uri: vscode.Uri): Promise<string | undefined> {
  try {
    const bytes = await vscode.workspace.fs.readFile(uri);
    return Buffer.from(bytes).toString('utf-8');
  } catch {
    return undefined;
  }
}

/**
 * Builds a multi-line diagnostic report for the `Diagnose Style Guide`
 * command. Mirrors the structure of `diagnoseGit` for consistency.
 */
export async function diagnoseStyleGuide(
  activeUri: vscode.Uri | undefined
): Promise<string> {
  const lines: string[] = [];
  lines.push('=== Style guide diagnostic ===');

  const language = activeUri ? detectLanguage(activeUri) : 'verse';
  lines.push(`Language: ${language}`);
  lines.push(`Active file: ${activeUri?.fsPath ?? '(no editor open)'}`);

  const config = vscode.workspace.getConfiguration('uefnCodeReview');
  const guideName = guideNameForLanguage(language, config);
  lines.push(`Configured guide name: ${guideName ?? '(none)'}`);

  const globalPath = config.get<string>('globalStyleGuidePath', '').trim();
  lines.push(`Global fallback path: ${globalPath || '(not set)'}`);
  lines.push('');

  const result = await loadStyleGuide(language, activeUri);

  lines.push('Paths searched (in order):');
  if (result.searchedPaths.length === 0) {
    lines.push('  (no paths attempted — no workspace folder open and no global fallback)');
  } else {
    for (const p of result.searchedPaths) {
      lines.push(`  - ${p}`);
    }
  }
  lines.push('');

  if (result.found) {
    lines.push(`✓ FOUND at: ${result.matchedPath}`);
    lines.push(`  Size: ${result.content?.length ?? 0} chars (${(result.content?.match(/\n/g)?.length ?? 0) + 1} lines)`);
    lines.push('');
    lines.push('  First 200 chars (verify it\'s the right guide):');
    lines.push('  -----');
    const preview = (result.content ?? '').substring(0, 200).replace(/\n/g, '\n  ');
    lines.push(`  ${preview}${(result.content?.length ?? 0) > 200 ? '\n  ...' : ''}`);
    lines.push('  -----');
    lines.push('');
    lines.push('Style guide is active. AI pre-review will use it as authority.');
  } else {
    lines.push('✗ NOT FOUND in any searched location.');
    lines.push('');
    lines.push('Fix options:');
    lines.push('  1. Place .verse-style.md at the root of your workspace folder.');
    if (vscode.workspace.workspaceFolders?.length) {
      lines.push(`     Suggested path: ${vscode.workspace.workspaceFolders[0].uri.fsPath}\\.verse-style.md`);
    }
    lines.push('  2. OR set uefnCodeReview.globalStyleGuidePath to an absolute path');
    lines.push('     (lets you share one guide across multiple UEFN projects).');
    lines.push('');
    lines.push('AI pre-review will run WITHOUT team conventions until the guide is found.');
  }

  return lines.join('\n');
}

function detectLanguage(uri: vscode.Uri): string {
  // VS Code language detection requires an open document; fall back to
  // file extension-based heuristic for the diagnostic output.
  const path = uri.fsPath.toLowerCase();
  if (path.endsWith('.verse')) return 'verse';
  if (path.endsWith('.py')) return 'python';
  return 'unknown';
}
