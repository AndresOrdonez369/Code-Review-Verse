import * as vscode from 'vscode';
import { sendToSlack, SlackConfig } from './slack';
import { runPreReviewWithFallback, listAvailableModels } from './gemini';
import { loadStyleGuide, diagnoseStyleGuide } from './styleGuide';
import { sessionStore, makeSnippetId } from './session';
import { createStatusBar } from './statusBar';
import { getOriginalFromGit, diagnoseGit } from './originalContent';
import { scopedUnifiedDiff, scopedDiffStats } from './diff';
import type { Snippet, ReviewMetadata, DiffStyle } from './types';

const SECRET_SLACK_WEBHOOK = 'uefnCodeReview.slackWebhook';
const SECRET_SLACK_BOT_TOKEN = 'uefnCodeReview.slackBotToken';
const SECRET_SLACK_CHANNEL_ID = 'uefnCodeReview.slackChannelId';
const SECRET_GEMINI_KEY = 'uefnCodeReview.geminiKey';

let outputChannel: vscode.OutputChannel;
let warnedNoStyleGuideThisSession = false;

function log(level: 'INFO' | 'WARN' | 'ERROR', msg: string): void {
  const ts = new Date().toISOString().substring(11, 19);
  outputChannel.appendLine(`[${ts}] [${level}] ${msg}`);
}

export function activate(context: vscode.ExtensionContext): void {
  outputChannel = vscode.window.createOutputChannel('UEFN Code Review');
  context.subscriptions.push(outputChannel);
  log('INFO', 'Extension activated (v0.2.9)');

  createStatusBar(context);

  context.subscriptions.push(
    vscode.commands.registerCommand('uefnCodeReview.addSnippet', () =>
      addSnippet(context)
    ),
    vscode.commands.registerCommand('uefnCodeReview.sendSession', () =>
      sendSession(context)
    ),
    vscode.commands.registerCommand('uefnCodeReview.discardSession', () =>
      discardSession()
    ),
    vscode.commands.registerCommand('uefnCodeReview.showSession', () =>
      showSession()
    ),
    vscode.commands.registerCommand('uefnCodeReview.configure', () =>
      configure(context)
    ),
    vscode.commands.registerCommand('uefnCodeReview.listModels', () =>
      listModelsCmd(context)
    ),
    vscode.commands.registerCommand('uefnCodeReview.diagnoseGit', () =>
      diagnoseGitCmd()
    ),
    vscode.commands.registerCommand('uefnCodeReview.diagnoseStyleGuide', () =>
      diagnoseStyleGuideCmd()
    )
  );
}

export function deactivate(): void {
  /* nothing */
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function displayFilename(uri: vscode.Uri): string {
  const rel = vscode.workspace.asRelativePath(uri, false);
  const isAbsolute = rel === uri.fsPath;
  let display: string;
  if (!isAbsolute) {
    display = rel;
  } else {
    const parts = uri.fsPath.split(/[\\/]/).filter(Boolean);
    display = parts.length <= 3 ? uri.fsPath : '…/' + parts.slice(-3).join('/');
  }
  if (display.length > 80) {
    const parts = display.split(/[\\/]/);
    display =
      parts.length > 1
        ? '…/' + parts.slice(-2).join('/')
        : display.substring(display.length - 80);
  }
  return display.replace(/\\/g, '/');
}

function clipboardPreview(text: string, maxLen: number = 70): string {
  const collapsed = text.trim().replace(/\s+/g, ' ');
  if (collapsed.length === 0) return '(empty)';
  if (collapsed.length <= maxLen) return collapsed;
  return collapsed.substring(0, maxLen) + '…';
}

function resolveTicket(
  raw: string,
  baseUrl: string
): { ticketId: string; ticketUrl: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { ticketId: '', ticketUrl: '' };
  if (/^https?:\/\//i.test(trimmed)) {
    const match = trimmed.match(/\/browse\/([A-Z][A-Z0-9_]+-\d+)/i);
    return {
      ticketId: match ? match[1] : trimmed,
      ticketUrl: trimmed,
    };
  }
  return {
    ticketId: trimmed,
    ticketUrl: baseUrl.replace(/\/?$/, '/') + trimmed,
  };
}

function shortReason(reason: string, maxLen: number = 90): string {
  const oneLine = reason.replace(/\n+/g, ' · ');
  return oneLine.length <= maxLen ? oneLine : oneLine.substring(0, maxLen) + '…';
}

async function resolveSlackConfig(
  context: vscode.ExtensionContext
): Promise<SlackConfig | undefined> {
  const botToken = await context.secrets.get(SECRET_SLACK_BOT_TOKEN);
  const channelId = await context.secrets.get(SECRET_SLACK_CHANNEL_ID);
  if (botToken && channelId) {
    return { mode: 'botToken', botToken, channelId };
  }
  const webhookUrl = await context.secrets.get(SECRET_SLACK_WEBHOOK);
  if (webhookUrl) {
    return { mode: 'webhook', webhookUrl };
  }
  return undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// Configure / List models / Diagnose Git / Diagnose Style Guide
// ─────────────────────────────────────────────────────────────────────────────

async function configure(context: vscode.ExtensionContext): Promise<void> {
  const mode = await vscode.window.showQuickPick(
    [
      {
        label: '$(comment-discussion) Bot Token mode (recommended for teams)',
        description: 'AI feedback in threads. Cleaner. Requires Slack App + chat:write scope.',
        detail: 'botToken',
      },
      {
        label: '$(rss) Webhook mode (simpler)',
        description: 'AI feedback inline. Single Incoming Webhook URL is enough.',
        detail: 'webhook',
      },
    ],
    { placeHolder: 'Slack delivery mode', ignoreFocusOut: true }
  );
  if (!mode) return;

  if (mode.detail === 'botToken') {
    const token = await vscode.window.showInputBox({
      prompt: 'Slack Bot Token (starts with xoxb-)',
      placeHolder: 'xoxb-...',
      password: true,
      ignoreFocusOut: true,
      validateInput: (v) =>
        v.startsWith('xoxb-')
          ? null
          : 'Bot tokens start with "xoxb-". Get one at api.slack.com/apps → OAuth & Permissions.',
    });
    if (!token) return;
    await context.secrets.store(SECRET_SLACK_BOT_TOKEN, token);

    const channelId = await vscode.window.showInputBox({
      prompt: 'Slack Channel ID (NOT the channel name — e.g. C012345678)',
      placeHolder: 'C012345678',
      ignoreFocusOut: true,
      validateInput: (v) =>
        /^[CG][A-Z0-9]{8,}$/i.test(v.trim())
          ? null
          : 'Channel ID must start with C or G and be 9+ chars.',
    });
    if (!channelId) return;
    await context.secrets.store(SECRET_SLACK_CHANNEL_ID, channelId.trim());
    await context.secrets.delete(SECRET_SLACK_WEBHOOK);
    log('INFO', 'Configured Bot Token mode (AI feedback in threads).');
  } else {
    const webhook = await vscode.window.showInputBox({
      prompt: 'Slack Incoming Webhook URL',
      placeHolder: 'https://hooks.slack.com/services/...',
      ignoreFocusOut: true,
      validateInput: (v) =>
        v.startsWith('https://hooks.slack.com/')
          ? null
          : 'Must be a Slack webhook URL',
    });
    if (!webhook) return;
    await context.secrets.store(SECRET_SLACK_WEBHOOK, webhook);
    await context.secrets.delete(SECRET_SLACK_BOT_TOKEN);
    await context.secrets.delete(SECRET_SLACK_CHANNEL_ID);
    log('INFO', 'Configured Webhook mode (AI feedback inline).');
  }

  const apiKey = await vscode.window.showInputBox({
    prompt: 'Gemini API Key (leave empty to disable AI pre-review)',
    placeHolder: 'AIza...',
    password: true,
    ignoreFocusOut: true,
  });
  if (apiKey) await context.secrets.store(SECRET_GEMINI_KEY, apiKey);

  const config = vscode.workspace.getConfiguration('uefnCodeReview');
  const author = await vscode.window.showInputBox({
    prompt: 'Your name (shown as Author in Slack)',
    value: config.get<string>('author', ''),
    ignoreFocusOut: true,
  });
  if (author) {
    await config.update('author', author, vscode.ConfigurationTarget.Global);
  }
  vscode.window.showInformationMessage('UEFN Code Review configured');
}

async function listModelsCmd(
  context: vscode.ExtensionContext
): Promise<void> {
  const apiKey = await context.secrets.get(SECRET_GEMINI_KEY);
  if (!apiKey) {
    vscode.window.showWarningMessage(
      'Gemini API key not configured. Run "Configure Credentials" first.'
    );
    return;
  }
  outputChannel.show(true);
  log('INFO', 'Querying available models...');
  try {
    const models = await listAvailableModels(apiKey);
    log('INFO', `Found ${models.length} models:`);
    for (const m of models) {
      log('INFO', `  ${m.name.padEnd(40)} ${m.supportsGenerate ? '✓ generate' : '✗ no-generate'}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log('ERROR', `listAvailableModels failed: ${msg}`);
    vscode.window.showErrorMessage(`Error querying models: ${msg}`);
  }
}

async function diagnoseGitCmd(): Promise<void> {
  outputChannel.show(true);
  const editor = vscode.window.activeTextEditor;
  const report = await diagnoseGit(editor?.document.uri);
  outputChannel.appendLine('');
  for (const line of report.split('\n')) outputChannel.appendLine(line);
  outputChannel.appendLine('');
}

async function diagnoseStyleGuideCmd(): Promise<void> {
  outputChannel.show(true);
  const editor = vscode.window.activeTextEditor;
  const report = await diagnoseStyleGuide(editor?.document.uri);
  outputChannel.appendLine('');
  for (const line of report.split('\n')) outputChannel.appendLine(line);
  outputChannel.appendLine('');
  // Reset the per-session warning so the user can re-trigger after fixing
  warnedNoStyleGuideThisSession = false;
}

// ─────────────────────────────────────────────────────────────────────────────
// Add snippet (unchanged from v0.2.7)
// ─────────────────────────────────────────────────────────────────────────────

async function addSnippet(context: vscode.ExtensionContext): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.selection.isEmpty) {
    vscode.window.showWarningMessage(
      'Select code in the editor before adding to review.'
    );
    return;
  }

  const config = vscode.workspace.getConfiguration('uefnCodeReview');
  const author = config.get<string>('author') || 'unknown';
  sessionStore.ensure(author);

  const newCode = editor.document.getText(editor.selection);
  const fullNewFile = editor.document.getText();
  const filename = displayFilename(editor.document.uri);
  const language = editor.document.languageId;
  const startLine = editor.selection.start.line + 1;
  const endLine = editor.selection.end.line + 1;
  const contextLines = config.get<number>('diffContextLines', 3);

  const useGit = config.get<boolean>('useGitForOldCode', true);
  let gitDiffText: string | undefined;
  let gitStatsText = '';
  let gitFailureReason: string | undefined;

  if (useGit) {
    const result = await getOriginalFromGit(editor.document.uri);
    if (result.found && result.content !== undefined) {
      if (result.content !== fullNewFile) {
        const diffText = scopedUnifiedDiff(
          result.content,
          fullNewFile,
          startLine,
          endLine,
          contextLines
        );
        const stats = scopedDiffStats(
          result.content,
          fullNewFile,
          startLine,
          endLine
        );
        if (diffText.length > 0) {
          gitDiffText = diffText;
          gitStatsText = `+${stats.added} -${stats.removed}`;
          log(
            'INFO',
            `Git diff for ${filename}: +${stats.added} -${stats.removed} (${stats.context} context)`
          );
        } else {
          gitFailureReason = 'No changes inside your selection (vs HEAD)';
        }
      } else {
        gitFailureReason = 'File matches HEAD exactly — nothing changed since last commit';
      }
    } else {
      gitFailureReason = result.reason ?? 'Unknown reason';
      log('WARN', `Git unavailable: ${gitFailureReason}`);
    }
  } else {
    gitFailureReason = 'Git auto-detection disabled in settings';
  }

  const clipText = await vscode.env.clipboard.readText();
  const choices: vscode.QuickPickItem[] = [];
  if (gitDiffText) {
    choices.push({
      label: '$(check) Use Git diff (recommended)',
      description: gitStatsText,
      detail: 'Auto-detected from your working tree vs HEAD.',
    });
  }
  choices.push({
    label:
      clipText.trim().length > 0
        ? '$(clippy) Use clipboard'
        : '$(clippy) Use clipboard (empty)',
    description:
      clipText.trim().length > 0
        ? `"${clipboardPreview(clipText)}"`
        : 'Nothing in clipboard',
  });
  choices.push({
    label: '$(circle-slash) No old code',
    description: 'Send only the new selection (no diff)',
  });
  if (!gitDiffText && useGit) {
    choices.push({
      label: '$(question) Why no Git option? Run diagnostic',
      description: 'Opens the Output Channel with details',
    });
  }

  const placeholder = gitDiffText
    ? 'Old code source — Git auto-detection succeeded'
    : `Git: ${shortReason(gitFailureReason ?? 'unknown')}`;

  const picked = await vscode.window.showQuickPick(choices, {
    placeHolder: placeholder,
    ignoreFocusOut: true,
  });
  if (!picked) return;

  if (picked.label.includes('diagnostic')) {
    await diagnoseGitCmd();
    return;
  }

  let oldCode: string | undefined;
  let diffText: string | undefined;
  let oldSource: 'git' | 'clipboard' | 'none' = 'none';

  if (picked.label.includes('Git diff')) {
    diffText = gitDiffText;
    oldSource = 'git';
  } else if (picked.label.includes('clipboard')) {
    if (clipText.trim().length === 0) {
      vscode.window.showWarningMessage(
        'Clipboard is empty — adding without old code.'
      );
    } else {
      oldCode = clipText;
      oldSource = 'clipboard';
    }
  }

  const note = await vscode.window.showInputBox({
    prompt: 'Optional note for this snippet (what / why)',
    placeHolder:
      'e.g. "Refactored damage calc to use 2-decimal format" — Esc to skip',
    ignoreFocusOut: false,
  });
  if (note === undefined) return;

  const snippet: Snippet = {
    id: makeSnippetId(),
    filename,
    language,
    startLine,
    endLine,
    newCode,
    diffText,
    oldCode,
    note: note.trim() || undefined,
  };

  sessionStore.addSnippet(snippet);
  log(
    'INFO',
    `Snippet added: ${filename} L${startLine}-${endLine} (old=${oldSource})` +
      (snippet.note ? ' (with note)' : '')
  );

  const next = await vscode.window.showInformationMessage(
    `Snippet added (${sessionStore.count()} total). What now?`,
    'Send Review',
    'Add Another',
    'Discard All'
  );

  if (next === 'Send Review') {
    await sendSession(context);
  } else if (next === 'Discard All') {
    discardSession();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Send session — now warns if style guide missing on first miss per session
// ─────────────────────────────────────────────────────────────────────────────

async function sendSession(context: vscode.ExtensionContext): Promise<void> {
  const session = sessionStore.current();
  if (!session || session.snippets.length === 0) {
    vscode.window.showWarningMessage(
      'No snippets to send. Use "Add Snippet to Review" first.'
    );
    return;
  }

  const slackConfig = await resolveSlackConfig(context);
  if (!slackConfig) {
    const action = await vscode.window.showWarningMessage(
      'Slack not configured. Configure now?',
      'Configure'
    );
    if (action === 'Configure') {
      await vscode.commands.executeCommand('uefnCodeReview.configure');
    }
    return;
  }

  const config = vscode.workspace.getConfiguration('uefnCodeReview');
  const metadata = await collectMetadata(context, config);
  if (!metadata) {
    log('INFO', 'Cancelled during metadata collection');
    return;
  }

  const enableAi = config.get<boolean>('enableAiPreReview', true);
  const diffStyle = config.get<DiffStyle>('diffStyle', 'unified');

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Code Review',
      cancellable: false,
    },
    async (progress) => {
      let aiOk = 0;
      let aiFailed = 0;
      const aiErrors: string[] = [];
      let firstSnippetGuideLoaded = false;
      let firstSnippetGuideMissing = false;

      if (enableAi) {
        const apiKey = await context.secrets.get(SECRET_GEMINI_KEY);
        if (!apiKey) {
          log('WARN', 'Gemini API key not configured — skipping AI');
          vscode.window.showWarningMessage(
            'AI pre-review skipped: Gemini API key not configured.'
          );
        } else {
          const total = session.snippets.length;
          for (let i = 0; i < total; i++) {
            const s = session.snippets[i];
            progress.report({
              message: `AI pre-review ${i + 1}/${total}: ${s.filename}`,
            });
            try {
              const guideResult = await loadStyleGuide(s.language);
              if (i === 0) {
                if (guideResult.found) {
                  firstSnippetGuideLoaded = true;
                  log(
                    'INFO',
                    `Style guide loaded from ${guideResult.matchedPath} (${guideResult.content?.length ?? 0} chars)`
                  );
                } else {
                  firstSnippetGuideMissing = true;
                  log(
                    'WARN',
                    `Style guide NOT found. Searched: ${guideResult.searchedPaths.join(' | ') || '(no paths)'}`
                  );
                }
              }
              const configuredModel = config.get<string>(
                'geminiModel',
                'gemini-2.5-flash'
              );
              const aiTemperature = config.get<number>('aiTemperature', 0.0);
              const { result, modelUsed } = await runPreReviewWithFallback(
                {
                  apiKey,
                  model: configuredModel,
                  code: s.newCode,
                  language: s.language,
                  styleGuide: guideResult.content,
                  temperature: aiTemperature,
                },
                (m) => log('INFO', `[snippet ${i + 1}] trying model: ${m}`)
              );
              s.preReview = result;
              aiOk++;
              log(
                'INFO',
                `[snippet ${i + 1}] OK with "${modelUsed}": severity=${result.severity}, ${result.issues.length} issues`
              );
            } catch (err) {
              aiFailed++;
              const msg = err instanceof Error ? err.message : String(err);
              aiErrors.push(`#${i + 1} (${s.filename}): ${msg}`);
              log('ERROR', `[snippet ${i + 1}] AI pre-review failed: ${msg}`);
            }
          }

          if (aiFailed > 0) {
            const sample = aiErrors[0].substring(0, 120);
            const action = await vscode.window.showWarningMessage(
              `AI pre-review: ${aiOk}/${session.snippets.length} OK, ${aiFailed} failed. First error: ${sample}`,
              'Show Log',
              'Send Anyway',
              'Cancel Send'
            );
            if (action === 'Cancel Send') return;
            if (action === 'Show Log') outputChannel.show(true);
          }
        }
      }

      // Style guide missing notification — only once per session
      if (
        firstSnippetGuideMissing &&
        !warnedNoStyleGuideThisSession &&
        enableAi
      ) {
        warnedNoStyleGuideThisSession = true;
        vscode.window
          .showWarningMessage(
            'No .verse-style.md found. AI ran with default conventions only — team-specific rules NOT applied. Add the guide to your workspace root or run Diagnose Style Guide.',
            'Diagnose Style Guide',
            'Dismiss'
          )
          .then((action) => {
            if (action === 'Diagnose Style Guide') {
              vscode.commands.executeCommand('uefnCodeReview.diagnoseStyleGuide');
            }
          });
      }

      const modeLabel = slackConfig.mode === 'botToken' ? 'thread' : 'inline';
      progress.report({ message: `Posting to Slack (${modeLabel} mode)...` });
      try {
        await sendToSlack(slackConfig, session, metadata, diffStyle);
        log(
          'INFO',
          `Posted to Slack OK in ${slackConfig.mode} mode (${session.snippets.length} snippets, AI: ${aiOk} ok / ${aiFailed} failed)`
        );
        sessionStore.clear();
        const aiSuffix = enableAi
          ? aiFailed > 0
            ? ` · AI: ${aiOk}/${session.snippets.length}`
            : ''
          : ' · AI off';
        const guideSuffix = firstSnippetGuideLoaded
          ? ' · guide loaded'
          : enableAi
          ? ' · ⚠️ no guide'
          : '';
        const modeNote =
          slackConfig.mode === 'botToken' ? ' · AI in thread 🧵' : '';
        vscode.window.showInformationMessage(
          `Code review posted (${session.snippets.length} snippet${session.snippets.length === 1 ? '' : 's'})${aiSuffix}${guideSuffix}${modeNote}`
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log('ERROR', `Slack post failed: ${msg}`);
        vscode.window.showErrorMessage(`Failed to post to Slack: ${msg}`);
      }
    }
  );
}

function discardSession(): void {
  const count = sessionStore.count();
  sessionStore.clear();
  if (count > 0) {
    log('INFO', `Discarded session with ${count} snippet(s)`);
    vscode.window.showInformationMessage(
      `Discarded ${count} snippet${count === 1 ? '' : 's'}.`
    );
  }
}

async function showSession(): Promise<void> {
  const session = sessionStore.current();
  if (!session || session.snippets.length === 0) {
    vscode.window.showInformationMessage('No active review session.');
    return;
  }
  const items: vscode.QuickPickItem[] = session.snippets.map((s, i) => {
    const hasDiff = !!(s.diffText || s.oldCode);
    return {
      label: `$(file-code) Snippet ${i + 1}: ${s.filename}`,
      description: `Lines ${s.startLine}–${s.endLine}  ·  ${s.language}${hasDiff ? '  ·  with diff' : ''}`,
      detail: s.note,
    };
  });
  items.push(
    { label: '', kind: vscode.QuickPickItemKind.Separator } as vscode.QuickPickItem,
    { label: '$(send) Send Review', description: 'Post all snippets to Slack' },
    { label: '$(trash) Discard All', description: 'Clear the session' }
  );
  const choice = await vscode.window.showQuickPick(items, {
    placeHolder: `${session.snippets.length} snippet(s) pending`,
  });
  if (!choice) return;
  if (choice.label.includes('Send Review')) {
    await vscode.commands.executeCommand('uefnCodeReview.sendSession');
  } else if (choice.label.includes('Discard All')) {
    discardSession();
  }
}

async function collectMetadata(
  context: vscode.ExtensionContext,
  config: vscode.WorkspaceConfiguration
): Promise<ReviewMetadata | undefined> {
  const ws = context.workspaceState;

  const typeOptions = config.get<string[]>('reviewTypes', [
    'Bug Fixed', 'Bug', 'New Feature', 'Refactor', 'Hotfix', 'Code Review', 'Question',
  ]);
  const lastType = ws.get<string>('lastType', typeOptions[0]);
  const type = await vscode.window.showQuickPick(typeOptions, {
    placeHolder: `Type — last: ${lastType}`,
    ignoreFocusOut: true,
  });
  if (!type) return undefined;
  await ws.update('lastType', type);

  const projectOptions = config.get<string[]>('projects', ['Programming', 'DnD']);
  const lastProject = ws.get<string>('lastProject', projectOptions[0]);
  const project = await vscode.window.showQuickPick(projectOptions, {
    placeHolder: `Project — last: ${lastProject}`,
    ignoreFocusOut: true,
  });
  if (!project) return undefined;
  await ws.update('lastProject', project);

  const title = await vscode.window.showInputBox({
    prompt: 'Title',
    placeHolder: 'Damage value remains capped at 4.00 on UI...',
    ignoreFocusOut: true,
    validateInput: (v) => v.trim().length > 0 ? null : 'Title is required',
  });
  if (!title) return undefined;

  const ticketRaw = (await vscode.window.showInputBox({
    prompt: 'Jira ticket ID OR full URL — empty if no ticket',
    placeHolder: 'DD-2645   or   https://teravisiongames.atlassian.net/browse/DD-2645',
    ignoreFocusOut: true,
  })) ?? '';

  const baseUrl = config.get<string>(
    'jiraBaseUrl',
    'https://teravisiongames.atlassian.net/browse/'
  );
  const { ticketId, ticketUrl } = resolveTicket(ticketRaw, baseUrl);

  const size = await vscode.window.showQuickPick(
    ['XS', 'S', 'M', 'L', 'XL'],
    { placeHolder: 'Size', ignoreFocusOut: true }
  );
  if (!size) return undefined;

  const summary: string[] = [];
  while (true) {
    const line = await vscode.window.showInputBox({
      prompt: `Summary bullet ${summary.length + 1} — empty Enter to finish`,
      placeHolder: summary.length === 0
        ? 'I made some adjustments to show that data...'
        : 'Add another bullet, or empty Enter to finish',
      ignoreFocusOut: true,
    });
    if (line === undefined) return undefined;
    if (line.trim() === '') break;
    summary.push(line);
  }

  const testedOptions = config.get<string[]>('testedInOptions', [
    'UEFN Session', 'UEFN Editor', 'Local', 'Manual',
  ]);
  const lastTested = ws.get<string>('lastTested', testedOptions[0]);
  const testedIn = await vscode.window.showQuickPick(testedOptions, {
    placeHolder: `Tested in — last: ${lastTested}`,
    ignoreFocusOut: true,
  });
  if (!testedIn) return undefined;
  await ws.update('lastTested', testedIn);

  const author = config.get<string>('author', 'Me');
  const lastTesters = ws.get<string>('lastTesters', author || 'Me');
  const testers = await vscode.window.showInputBox({
    prompt: 'Testers (comma separated)',
    value: lastTesters,
    ignoreFocusOut: true,
  });
  if (testers === undefined) return undefined;
  await ws.update('lastTesters', testers);

  return {
    title, type, project, ticketId, ticketUrl, size, summary, testedIn, testers,
  };
}
