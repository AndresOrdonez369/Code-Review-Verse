/**
 * Shared types for the Code Review system (v0.2.3).
 */

export interface PreReviewRequest {
  apiKey: string;
  model: string;
  code: string;
  language: string;
  styleGuide?: string;
}

export interface PreReviewIssue {
  severity: 'low' | 'medium' | 'high';
  message: string;
}

export interface PreReviewResult {
  severity: 'none' | 'low' | 'medium' | 'high';
  summary: string;
  issues: PreReviewIssue[];
  suggestions: string[];
}

/**
 * One reviewable code change.
 *
 * v0.2.3: when the snippet's old version comes from Git, we precompute
 * the unified diff with context and store it in `diffText`. Slack
 * renders it directly. For clipboard-sourced snippets, `diffText` is
 * absent and `oldCode` + `newCode` are diffed at render time.
 */
export interface Snippet {
  id: string;
  filename: string;
  language: string;
  startLine: number;
  endLine: number;
  newCode: string;

  /** Precomputed unified diff (Git source). When present, takes precedence. */
  diffText?: string;

  /** Old code from clipboard (legacy / fallback path). */
  oldCode?: string;

  note?: string;
  preReview?: PreReviewResult;
}

export interface ReviewMetadata {
  title: string;
  type: string;
  project: string;
  ticketId: string;
  ticketUrl: string;
  size: string;
  summary: string[];
  testedIn: string;
  testers: string;
}

export interface ReviewSession {
  author: string;
  snippets: Snippet[];
  createdAt: number;
}

export type DiffStyle = 'unified' | 'side-by-side';
