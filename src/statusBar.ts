import * as vscode from 'vscode';
import { sessionStore } from './session';

/**
 * Status bar item that shows the count of pending snippets.
 * Click → triggers the "Send Review" command.
 * Hidden when no session is active (no clutter for users who never use it).
 */
export function createStatusBar(
  context: vscode.ExtensionContext
): vscode.StatusBarItem {
  const item = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  item.command = 'uefnCodeReview.sendSession';

  const update = (): void => {
    const count = sessionStore.count();
    if (count === 0) {
      item.hide();
      return;
    }
    item.text = `$(eye) Review (${count})`;
    item.tooltip = new vscode.MarkdownString(
      `**${count} snippet${count === 1 ? '' : 's'} pending for review**\n\n` +
        'Click to send all to Slack.\n\n' +
        'Or run `Code Review: Discard Pending Review` to clear.'
    );
    item.show();
  };

  context.subscriptions.push(item, sessionStore.onChange(update));
  update();
  return item;
}
