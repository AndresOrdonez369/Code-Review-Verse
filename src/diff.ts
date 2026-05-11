/**
 * Line-based diff using LCS, scoped to a selection range.
 *
 * v0.2.7: extend the selection range through contiguous '-' lines so the
 * stats (`+1 -1`) match what the user sees in the diff. Without this, a
 * simple uncomment/rename shows `+1 -0` because the corresponding '-' line
 * has no newLineNum to match the user's selection.
 */

const MAX_LINES = 1000;

export interface DiffLine {
  type: '+' | '-' | ' ';
  text: string;
  oldLineNum?: number;
  newLineNum?: number;
}

export interface DiffStats {
  added: number;
  removed: number;
  context: number;
}

function normalizeText(text: string): string {
  if (text.length > 0 && text.charCodeAt(0) === 0xfeff) {
    text = text.substring(1);
  }
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

export function unifiedDiff(oldText: string, newText: string): string {
  return annotatedDiff(oldText, newText)
    .map((l) => `${l.type} ${l.text}`)
    .join('\n');
}

export function annotatedDiff(oldText: string, newText: string): DiffLine[] {
  const a = normalizeText(oldText).split('\n');
  const b = normalizeText(newText).split('\n');

  if (a.length > MAX_LINES || b.length > MAX_LINES) {
    const out: DiffLine[] = [];
    a.forEach((t, i) => out.push({ type: '-', text: t, oldLineNum: i + 1 }));
    b.forEach((t, i) => out.push({ type: '+', text: t, newLineNum: i + 1 }));
    return out;
  }
  return lcsAnnotated(a, b);
}

function lcsAnnotated(a: string[], b: string[]): DiffLine[] {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = [];
  for (let i = 0; i <= m; i++) dp.push(new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }
  const result: DiffLine[] = [];
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      result.push({ type: ' ', text: a[i - 1], oldLineNum: i, newLineNum: j });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.push({ type: '+', text: b[j - 1], newLineNum: j });
      j--;
    } else {
      result.push({ type: '-', text: a[i - 1], oldLineNum: i });
      i--;
    }
  }
  return result.reverse();
}

/**
 * Find the [minIdx, maxIdx] window of `annotated` that includes:
 *   1. Every entry whose newLineNum is in [newStart, newEnd]
 *   2. Plus all CONTIGUOUS '-' lines adjacent to that window (same hunk).
 *
 * The contiguous extension is critical: '-' lines have no newLineNum, so
 * they wouldn't match the selection range even when they're semantically
 * part of the same change (e.g. a one-line uncomment produces a '-' / '+'
 * pair where only the '+' has newLineNum). Without extension, stats are
 * wrong and zero-context diff modes lose information.
 *
 * Stops extending at the first context line — never crosses a hunk boundary.
 */
function findHunkRange(
  annotated: DiffLine[],
  newStart: number,
  newEnd: number
): { minIdx: number; maxIdx: number } {
  let minIdx = -1;
  let maxIdx = -1;
  for (let k = 0; k < annotated.length; k++) {
    const ln = annotated[k].newLineNum;
    if (ln !== undefined && ln >= newStart && ln <= newEnd) {
      if (minIdx === -1) minIdx = k;
      maxIdx = k;
    }
  }
  if (minIdx === -1) return { minIdx: -1, maxIdx: -1 };

  while (minIdx > 0 && annotated[minIdx - 1].type === '-') minIdx--;
  while (maxIdx < annotated.length - 1 && annotated[maxIdx + 1].type === '-')
    maxIdx++;

  return { minIdx, maxIdx };
}

export function scopedUnifiedDiff(
  oldText: string,
  newText: string,
  newStart: number,
  newEnd: number,
  contextLines: number = 3
): string {
  const annotated = annotatedDiff(oldText, newText);
  const { minIdx, maxIdx } = findHunkRange(annotated, newStart, newEnd);
  if (minIdx === -1) return '';

  const start = Math.max(0, minIdx - contextLines);
  const end = Math.min(annotated.length - 1, maxIdx + contextLines);

  return annotated
    .slice(start, end + 1)
    .map((d) => `${d.type} ${d.text}`)
    .join('\n');
}

export function scopedDiffStats(
  oldText: string,
  newText: string,
  newStart: number,
  newEnd: number
): DiffStats {
  const annotated = annotatedDiff(oldText, newText);
  const { minIdx, maxIdx } = findHunkRange(annotated, newStart, newEnd);
  if (minIdx === -1) return { added: 0, removed: 0, context: 0 };

  let added = 0;
  let removed = 0;
  let context = 0;
  for (let k = minIdx; k <= maxIdx; k++) {
    if (annotated[k].type === '+') added++;
    else if (annotated[k].type === '-') removed++;
    else context++;
  }
  return { added, removed, context };
}

export function diffStats(oldText: string, newText: string): {
  added: number;
  removed: number;
} {
  const annotated = annotatedDiff(oldText, newText);
  let added = 0;
  let removed = 0;
  for (const line of annotated) {
    if (line.type === '+') added++;
    else if (line.type === '-') removed++;
  }
  return { added, removed };
}

export function countDiffPrefixes(diffText: string): {
  added: number;
  removed: number;
} {
  let added = 0;
  let removed = 0;
  for (const line of diffText.split('\n')) {
    if (line.startsWith('+ ')) added++;
    else if (line.startsWith('- ')) removed++;
  }
  return { added, removed };
}
