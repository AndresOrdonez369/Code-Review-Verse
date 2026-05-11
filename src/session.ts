import * as vscode from 'vscode';
import type { Snippet, ReviewSession } from './types';

/**
 * In-memory store for the active review session.
 *
 * Why in-memory and not workspaceState?
 * - A review session is a "draft email": short-lived, cancellable, tied to a flow.
 * - If the user closes VS Code mid-session, restoring half-baked state is more
 *   confusing than starting fresh.
 * - Avoids edge cases with stale snippets pointing at code that has changed.
 *
 * If we ever want persistence, swap the in-memory field for context.workspaceState.
 */
class SessionStore {
  private session: ReviewSession | undefined;
  private listeners: Array<() => void> = [];

  start(author: string): ReviewSession {
    this.session = { author, snippets: [], createdAt: Date.now() };
    this.notify();
    return this.session;
  }

  /** Returns the active session or starts a new one with the given author. */
  ensure(author: string): ReviewSession {
    if (!this.session) return this.start(author);
    return this.session;
  }

  current(): ReviewSession | undefined {
    return this.session;
  }

  count(): number {
    return this.session?.snippets.length ?? 0;
  }

  addSnippet(snippet: Snippet): void {
    if (!this.session) {
      throw new Error('No active review session');
    }
    this.session.snippets.push(snippet);
    this.notify();
  }

  removeSnippet(id: string): void {
    if (!this.session) return;
    const before = this.session.snippets.length;
    this.session.snippets = this.session.snippets.filter((s) => s.id !== id);
    if (this.session.snippets.length !== before) this.notify();
  }

  clear(): void {
    if (!this.session) return;
    this.session = undefined;
    this.notify();
  }

  /** Subscribes to session changes. Returns disposable. */
  onChange(cb: () => void): vscode.Disposable {
    this.listeners.push(cb);
    return {
      dispose: () => {
        this.listeners = this.listeners.filter((l) => l !== cb);
      },
    };
  }

  private notify(): void {
    for (const cb of this.listeners) {
      try {
        cb();
      } catch {
        /* listener threw — don't break the rest */
      }
    }
  }
}

export const sessionStore = new SessionStore();

/** Generate a short id for a snippet. */
export function makeSnippetId(): string {
  return Math.random().toString(36).substring(2, 10);
}
