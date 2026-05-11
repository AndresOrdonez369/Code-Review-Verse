import * as https from 'https';
import { URL } from 'url';
import { unifiedDiff, diffStats, countDiffPrefixes } from './diff';
import type {
  ReviewSession,
  ReviewMetadata,
  Snippet,
  PreReviewResult,
  DiffStyle,
} from './types';

/**
 * Two delivery modes (v0.2.7):
 *
 * 1. WEBHOOK MODE — single message, AI inline. Simplest setup.
 * 2. BOT TOKEN MODE — main message stays clean (just diff + metadata),
 *    AI feedback posted as a thread reply. Requires bot token + channel ID.
 */

export interface SlackWebhookConfig {
  mode: 'webhook';
  webhookUrl: string;
}

export interface SlackBotConfig {
  mode: 'botToken';
  botToken: string;
  channelId: string;
}

export type SlackConfig = SlackWebhookConfig | SlackBotConfig;

export async function sendToSlack(
  config: SlackConfig,
  session: ReviewSession,
  metadata: ReviewMetadata,
  diffStyle: DiffStyle
): Promise<void> {
  if (config.mode === 'webhook') {
    return sendViaWebhook(config.webhookUrl, session, metadata, diffStyle);
  }
  return sendViaBotToken(
    config.botToken,
    config.channelId,
    session,
    metadata,
    diffStyle
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Webhook mode (legacy, unchanged behavior)
// ─────────────────────────────────────────────────────────────────────────────

async function sendViaWebhook(
  webhookUrl: string,
  session: ReviewSession,
  metadata: ReviewMetadata,
  diffStyle: DiffStyle
): Promise<void> {
  // Webhook posts everything inline (no thread support)
  const blocks = buildAllBlocks(session, metadata, diffStyle, true);
  const fallbackText = `[${metadata.project}] [${metadata.type}] ${metadata.title}`;
  const body = JSON.stringify({ text: fallbackText, blocks });

  return new Promise<void>((resolve, reject) => {
    let url: URL;
    try {
      url = new URL(webhookUrl);
    } catch {
      reject(new Error('Invalid webhook URL'));
      return;
    }
    const req = https.request(
      {
        hostname: url.hostname,
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          if (res.statusCode === 200) resolve();
          else reject(new Error(`Slack responded ${res.statusCode}: ${data}`));
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Bot Token mode (new — main + AI thread reply)
// ─────────────────────────────────────────────────────────────────────────────

async function sendViaBotToken(
  botToken: string,
  channelId: string,
  session: ReviewSession,
  metadata: ReviewMetadata,
  diffStyle: DiffStyle
): Promise<void> {
  // 1. Main message: header + metadata + diffs (NO AI inline)
  const mainBlocks = buildAllBlocks(session, metadata, diffStyle, false);
  const fallbackText = `[${metadata.project}] [${metadata.type}] ${metadata.title}`;

  const mainTs = await postChatMessage(botToken, {
    channel: channelId,
    text: fallbackText,
    blocks: mainBlocks,
  });

  // 2. Thread reply: AI feedback (only if any snippet has it)
  const hasAi = session.snippets.some((s) => s.preReview);
  if (hasAi) {
    const threadBlocks = buildAiThreadBlocks(session);
    await postChatMessage(botToken, {
      channel: channelId,
      thread_ts: mainTs,
      text: '🤖 AI Pre-review',
      blocks: threadBlocks,
    });
  }
}

interface PostChatMessageBody {
  channel: string;
  text: string;
  blocks: unknown[];
  thread_ts?: string;
}

/**
 * Posts a message via Slack Web API. Returns the message timestamp (ts)
 * so it can be used as thread_ts for replies.
 */
async function postChatMessage(
  botToken: string,
  body: PostChatMessageBody
): Promise<string> {
  const payload = JSON.stringify(body);
  return new Promise<string>((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'slack.com',
        path: '/api/chat.postMessage',
        method: 'POST',
        headers: {
          Authorization: `Bearer ${botToken}`,
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          let parsed: any;
          try {
            parsed = JSON.parse(data);
          } catch {
            reject(new Error(`Non-JSON response from Slack: ${data.substring(0, 200)}`));
            return;
          }
          if (res.statusCode !== 200) {
            reject(new Error(`HTTP ${res.statusCode}: ${data.substring(0, 200)}`));
            return;
          }
          if (!parsed.ok) {
            const err = parsed.error || 'unknown_error';
            const help =
              err === 'not_in_channel'
                ? ' — invite the bot to the channel: /invite @<bot-name>'
                : err === 'channel_not_found'
                ? ' — verify the channel ID (looks like C012345678) — not the channel NAME'
                : err === 'invalid_auth'
                ? ' — bot token is invalid or expired; regenerate at api.slack.com/apps'
                : '';
            reject(new Error(`Slack API error: ${err}${help}`));
            return;
          }
          resolve(parsed.ts);
        });
      }
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Block builders
// ─────────────────────────────────────────────────────────────────────────────

const SLACK_BLOCK_TEXT_LIMIT = 2900;
const SLACK_MAX_BLOCKS = 50;

function truncate(text: string, max: number = SLACK_BLOCK_TEXT_LIMIT): string {
  if (text.length <= max) return text;
  return text.substring(0, max - 20) + '\n... [truncated]';
}

function severityEmoji(severity: PreReviewResult['severity']): string {
  switch (severity) {
    case 'high':
      return '🚨';
    case 'medium':
      return '⚠️';
    case 'low':
      return 'ℹ️';
    case 'none':
    default:
      return '✅';
  }
}

function aggregateSeverity(snippets: Snippet[]): PreReviewResult['severity'] {
  const order: PreReviewResult['severity'][] = ['none', 'low', 'medium', 'high'];
  let max = 0;
  for (const s of snippets) {
    if (!s.preReview) continue;
    const idx = order.indexOf(s.preReview.severity);
    if (idx > max) max = idx;
  }
  return order[max];
}

function snippetStats(s: Snippet): { added: number; removed: number } {
  if (s.diffText) return countDiffPrefixes(s.diffText);
  if (s.oldCode && s.oldCode.length > 0)
    return diffStats(s.oldCode, s.newCode);
  return { added: 0, removed: 0 };
}

/**
 * Builds the main message blocks. If `inlineAi` is true, AI feedback is
 * embedded after each snippet's diff (webhook mode). Otherwise the main
 * message is clean and AI goes in a thread reply (bot token mode).
 */
function buildAllBlocks(
  session: ReviewSession,
  m: ReviewMetadata,
  diffStyle: DiffStyle,
  inlineAi: boolean
): unknown[] {
  const blocks: unknown[] = [];

  blocks.push({
    type: 'header',
    text: {
      type: 'plain_text',
      text: `[${m.project}] [${m.type}] ${m.title}`.substring(0, 150),
      emoji: true,
    },
  });

  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: `*Author:* ${session.author}  ·  *Size:* ${m.size}  ·  *Tested in:* ${m.testedIn}  ·  *Testers:* ${m.testers}`,
      },
    ],
  });

  if (m.ticketId && m.ticketUrl) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Ticket:* <${m.ticketUrl}|${m.ticketId}>`,
      },
    });
  } else if (m.ticketId) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*Ticket:* ${m.ticketId}` },
    });
  }

  if (m.summary.length > 0) {
    const bulletText = m.summary.map((s) => `• ${s}`).join('\n');
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Summary*\n${truncate(bulletText)}`,
      },
    });
  }

  // Snippet count + (in webhook mode only) aggregate AI severity
  const aggSev = aggregateSeverity(session.snippets);
  const hasAnyAi = session.snippets.some((s) => s.preReview);
  const headerSummaryParts = [
    `📦 *${session.snippets.length} snippet${session.snippets.length === 1 ? '' : 's'}*`,
  ];
  if (hasAnyAi) {
    if (inlineAi) {
      headerSummaryParts.push(
        `${severityEmoji(aggSev)} *AI overall: ${aggSev.toUpperCase()}*`
      );
    } else {
      headerSummaryParts.push(
        `${severityEmoji(aggSev)} *AI overall: ${aggSev.toUpperCase()}* — _details in thread_ 🧵`
      );
    }
  }
  blocks.push({
    type: 'context',
    elements: [{ type: 'mrkdwn', text: headerSummaryParts.join('  ·  ') }],
  });

  blocks.push({ type: 'divider' });

  for (let i = 0; i < session.snippets.length; i++) {
    const snippet = session.snippets[i];
    pushSnippetBlocks(
      blocks,
      snippet,
      i + 1,
      session.snippets.length,
      diffStyle,
      inlineAi
    );

    if (i < session.snippets.length - 1) {
      blocks.push({ type: 'divider' });
    }

    if (blocks.length > SLACK_MAX_BLOCKS - 3) {
      blocks.push({
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `_(${session.snippets.length - i - 1} additional snippet(s) omitted — Slack 50-block limit. Split into multiple reviews.)_`,
          },
        ],
      });
      break;
    }
  }

  blocks.push({ type: 'divider' });
  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: 'React  ✅ approve  ·  🔁 request changes  ·  👀 reviewing  ·  💬 comment in thread',
      },
    ],
  });

  return blocks;
}

function pushSnippetBlocks(
  blocks: unknown[],
  s: Snippet,
  index: number,
  total: number,
  diffStyle: DiffStyle,
  inlineAi: boolean
): void {
  const { added, removed } = snippetStats(s);
  const stats = added + removed > 0 ? `  ·  *+${added} -${removed}*` : '';

  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `*Snippet ${index}/${total}*  ·  \`${s.filename}\`  ·  Lines ${s.startLine}–${s.endLine}  ·  \`${s.language}\`${stats}`,
    },
  });

  if (s.note && s.note.trim().length > 0) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*Note:* ${s.note}` },
    });
  }

  if (s.diffText) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '```diff\n' + truncate(s.diffText) + '\n```',
      },
    });
  } else if (s.oldCode && s.oldCode.length > 0) {
    if (diffStyle === 'unified') {
      const diffText = unifiedDiff(s.oldCode, s.newCode);
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: '```diff\n' + truncate(diffText) + '\n```' },
      });
    } else {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*Before*\n```' + s.language + '\n' + truncate(s.oldCode) + '\n```',
        },
      });
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*After*\n```' + s.language + '\n' + truncate(s.newCode) + '\n```',
        },
      });
    }
  } else {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '```' + s.language + '\n' + truncate(s.newCode) + '\n```',
      },
    });
  }

  // Inline AI feedback (webhook mode only)
  if (inlineAi && s.preReview) {
    blocks.push(buildAiContextBlock(s.preReview));
  }
}

function buildAiContextBlock(p: PreReviewResult): unknown {
  const lines: string[] = [
    `${severityEmoji(p.severity)} *AI Pre-review — ${p.severity.toUpperCase()}* — ${p.summary}`,
  ];
  if (p.issues.length > 0) {
    lines.push(...p.issues.map((i) => `   • [${i.severity}] ${i.message}`));
  }
  if (p.suggestions.length > 0) {
    lines.push('   _Suggestions:_');
    lines.push(...p.suggestions.map((x) => `   • ${x}`));
  }
  return {
    type: 'context',
    elements: [{ type: 'mrkdwn', text: truncate(lines.join('\n')) }],
  };
}

/**
 * Builds the AI feedback that goes in the thread reply (bot token mode).
 * One section per snippet that has AI feedback.
 */
function buildAiThreadBlocks(session: ReviewSession): unknown[] {
  const blocks: unknown[] = [];

  blocks.push({
    type: 'header',
    text: {
      type: 'plain_text',
      text: '🤖 AI Pre-review — Style guide compliance',
      emoji: true,
    },
  });

  const aggSev = aggregateSeverity(session.snippets);
  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: `${severityEmoji(aggSev)} *Overall severity:* ${aggSev.toUpperCase()}`,
      },
    ],
  });

  for (let i = 0; i < session.snippets.length; i++) {
    const s = session.snippets[i];
    if (!s.preReview) continue;

    blocks.push({ type: 'divider' });
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Snippet ${i + 1}*  ·  \`${s.filename}\`  ·  Lines ${s.startLine}–${s.endLine}`,
      },
    });

    const p = s.preReview;
    const lines: string[] = [
      `${severityEmoji(p.severity)} *${p.severity.toUpperCase()}* — ${p.summary}`,
    ];
    if (p.issues.length > 0) {
      lines.push('');
      lines.push('*Issues:*');
      lines.push(...p.issues.map((iss) => `• [${iss.severity}] ${iss.message}`));
    }
    if (p.suggestions.length > 0) {
      lines.push('');
      lines.push('*Suggestions:*');
      lines.push(...p.suggestions.map((sg) => `• ${sg}`));
    }
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: truncate(lines.join('\n')) },
    });

    if (blocks.length > SLACK_MAX_BLOCKS - 2) {
      blocks.push({
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: '_(remaining snippets omitted — block limit hit)_',
          },
        ],
      });
      break;
    }
  }

  return blocks;
}
