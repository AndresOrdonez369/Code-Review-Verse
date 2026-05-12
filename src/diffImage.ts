import { Resvg } from '@resvg/resvg-js';

const MAX_LINES = 80;
const MAX_LINE_CHARS = 140;
const FONT_SIZE = 13;
const LINE_HEIGHT = 18;
const CHAR_WIDTH = 7.8;
const PAD_X = 16;
const PAD_Y = 12;
const GUTTER_W = 44;

const THEME = {
  bg: '#0d1117',
  border: '#30363d',
  addBg: '#033a16',
  addText: '#7ee787',
  delBg: '#5a1e02',
  delText: '#ffa198',
  ctxText: '#c9d1d9',
  gutterBg: '#161b22',
  gutterText: '#6e7681',
  markerBg: '#1f2933',
  markerText: '#8b949e',
};

interface ParsedLine {
  type: '+' | '-' | ' ';
  text: string;
}

function parseDiff(diffText: string): ParsedLine[] {
  const out: ParsedLine[] = [];
  for (const raw of diffText.split('\n')) {
    if (raw.length === 0) continue;
    const first = raw[0];
    if (first === '+' || first === '-') {
      out.push({ type: first, text: raw.length > 1 && raw[1] === ' ' ? raw.substring(2) : raw.substring(1) });
    } else {
      out.push({ type: ' ', text: raw.length > 1 && raw[0] === ' ' ? raw.substring(2) : raw });
    }
  }
  return out;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function clipLine(text: string): string {
  if (text.length <= MAX_LINE_CHARS) return text;
  return text.substring(0, MAX_LINE_CHARS - 1) + '…';
}

function buildSvg(lines: ParsedLine[], omitted: number): string {
  const maxChars = Math.min(
    MAX_LINE_CHARS,
    lines.reduce((m, l) => Math.max(m, l.text.length), 0)
  );
  const contentW = Math.max(200, Math.ceil(maxChars * CHAR_WIDTH));
  const width = GUTTER_W + PAD_X + contentW + PAD_X;
  const rowCount = lines.length + (omitted > 0 ? 1 : 0);
  const height = PAD_Y * 2 + rowCount * LINE_HEIGHT;

  const rows: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const y = PAD_Y + i * LINE_HEIGHT;
    const rowBg =
      l.type === '+' ? THEME.addBg : l.type === '-' ? THEME.delBg : null;
    if (rowBg) {
      rows.push(
        `<rect x="0" y="${y}" width="${width}" height="${LINE_HEIGHT}" fill="${rowBg}"/>`
      );
    }
    const marker = l.type === ' ' ? '' : l.type;
    const markerColor =
      l.type === '+' ? THEME.addText : l.type === '-' ? THEME.delText : THEME.gutterText;
    rows.push(
      `<text x="${GUTTER_W - 12}" y="${y + LINE_HEIGHT - 5}" font-family="monospace" font-size="${FONT_SIZE}" fill="${markerColor}" text-anchor="end">${marker}</text>`
    );
    const textColor =
      l.type === '+' ? THEME.addText : l.type === '-' ? THEME.delText : THEME.ctxText;
    rows.push(
      `<text x="${GUTTER_W + PAD_X}" y="${y + LINE_HEIGHT - 5}" font-family="monospace" font-size="${FONT_SIZE}" fill="${textColor}" xml:space="preserve">${escapeXml(clipLine(l.text))}</text>`
    );
  }

  if (omitted > 0) {
    const y = PAD_Y + lines.length * LINE_HEIGHT;
    rows.push(
      `<rect x="0" y="${y}" width="${width}" height="${LINE_HEIGHT}" fill="${THEME.markerBg}"/>`
    );
    rows.push(
      `<text x="${GUTTER_W + PAD_X}" y="${y + LINE_HEIGHT - 5}" font-family="monospace" font-size="${FONT_SIZE}" fill="${THEME.markerText}" font-style="italic">… ${omitted} more line${omitted === 1 ? '' : 's'} (truncated)</text>`
    );
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<rect width="${width}" height="${height}" fill="${THEME.bg}"/>
<rect x="0" y="0" width="${GUTTER_W}" height="${height}" fill="${THEME.gutterBg}"/>
<rect x="0" y="0" width="${width}" height="${height}" fill="none" stroke="${THEME.border}" stroke-width="1"/>
${rows.join('\n')}
</svg>`;
}

/**
 * Renders a unified-diff string to a PNG buffer (dark theme, GitHub-ish).
 * Truncates to 80 lines with a marker line at the bottom.
 */
export function renderDiffPng(diffText: string): Buffer {
  const allLines = parseDiff(diffText);
  const truncated = allLines.length > MAX_LINES;
  const lines = truncated ? allLines.slice(0, MAX_LINES) : allLines;
  const omitted = truncated ? allLines.length - MAX_LINES : 0;

  const svg = buildSvg(lines, omitted);
  const resvg = new Resvg(svg, {
    background: THEME.bg,
    font: {
      loadSystemFonts: true,
      defaultFontFamily: 'Consolas',
    },
    fitTo: { mode: 'width', value: Math.min(1800, getSvgWidth(svg)) },
  });
  return resvg.render().asPng();
}

function getSvgWidth(svg: string): number {
  const m = svg.match(/width="(\d+)"/);
  return m ? parseInt(m[1], 10) : 800;
}

/**
 * Renders plain code (no +/- prefixes) to PNG. Used for snippets without diff.
 */
export function renderCodePng(code: string): Buffer {
  const lines: ParsedLine[] = code.split('\n').map((t) => ({ type: ' ', text: t }));
  const truncated = lines.length > MAX_LINES;
  const shown = truncated ? lines.slice(0, MAX_LINES) : lines;
  const omitted = truncated ? lines.length - MAX_LINES : 0;
  const svg = buildSvg(shown, omitted);
  const resvg = new Resvg(svg, {
    background: THEME.bg,
    font: { loadSystemFonts: true, defaultFontFamily: 'Consolas' },
    fitTo: { mode: 'width', value: Math.min(1800, getSvgWidth(svg)) },
  });
  return resvg.render().asPng();
}
