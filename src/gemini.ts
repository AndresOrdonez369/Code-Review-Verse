import * as https from 'https';
import { buildSystemPrompt } from './prompts';
import type { PreReviewRequest, PreReviewResult } from './types';

const FALLBACK_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-1.5-flash',
];

export interface PreReviewRequestWithTemperature extends PreReviewRequest {
  /**
   * Generation temperature passed to Gemini.
   *   0.0 = greedy decoding (most consistent, recommended for code review)
   *   0.2 = old default — same input could yield different reviews
   *   1.0 = high variance (don't use for review)
   * Defaults to 0.0 when undefined.
   */
  temperature?: number;
}

export async function runPreReviewWithFallback(
  req: PreReviewRequestWithTemperature,
  onAttempt?: (model: string) => void
): Promise<{ result: PreReviewResult; modelUsed: string }> {
  const models = [
    req.model,
    ...FALLBACK_MODELS.filter((m) => m !== req.model),
  ];
  let lastError: Error | undefined;

  for (const model of models) {
    onAttempt?.(model);
    try {
      const result = await runPreReview({ ...req, model });
      return { result, modelUsed: model };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      lastError = err instanceof Error ? err : new Error(msg);
      const isModelError =
        /not found|not supported|unsupported|invalid model|limit:\s*0/i.test(
          msg
        );
      if (!isModelError) throw lastError;
    }
  }
  throw lastError ?? new Error('No working Gemini model found');
}

export async function runPreReview(
  req: PreReviewRequestWithTemperature
): Promise<PreReviewResult> {
  const systemPrompt = buildSystemPrompt(req.language, req.styleGuide);
  const userPrompt =
    `Review this ${req.language} snippet against the team style guide.\n\n` +
    'Code:\n```' + req.language + '\n' + req.code + '\n```\n\n' +
    'Apply the priority-ordered checklist from the system prompt. ' +
    'Be thorough — investigate Concurrency/Security/Effects/Persistence dimensions BEFORE deciding severity. ' +
    'Cite [Section] tags and use 🔴/🟡/💭 emojis as specified.';

  const body = {
    contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
    systemInstruction: { parts: [{ text: systemPrompt }] },
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['none', 'low', 'medium', 'high'] },
          summary: { type: 'string' },
          issues: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                severity: { type: 'string', enum: ['low', 'medium', 'high'] },
                message: { type: 'string' },
              },
              required: ['severity', 'message'],
            },
          },
          suggestions: { type: 'array', items: { type: 'string' } },
        },
        required: ['severity', 'summary', 'issues', 'suggestions'],
      },
      // v0.2.9: greedy decoding for consistency.
      // Caller can override via req.temperature; default 0 means "same code
      // → same review" (modulo server-side model updates from Google).
      temperature: req.temperature ?? 0.0,
      // topP=1 with temperature=0 makes decoding fully greedy.
      topP: 1.0,
    },
  };

  const path = `/v1beta/models/${encodeURIComponent(req.model)}:generateContent?key=${encodeURIComponent(req.apiKey)}`;
  const data = await httpsPostJson(
    'generativelanguage.googleapis.com',
    path,
    body
  );

  const text: string | undefined =
    data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error('Empty response from Gemini');
  }

  let parsed: PreReviewResult;
  try {
    parsed = JSON.parse(text) as PreReviewResult;
  } catch {
    throw new Error('Gemini returned invalid JSON');
  }

  return {
    severity: parsed.severity ?? 'none',
    summary: parsed.summary ?? 'No observations',
    issues: Array.isArray(parsed.issues) ? parsed.issues : [],
    suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : [],
  };
}

export async function listAvailableModels(apiKey: string): Promise<
  Array<{ name: string; supportsGenerate: boolean }>
> {
  const path = `/v1beta/models?key=${encodeURIComponent(apiKey)}`;
  const data = await httpsGetJson(
    'generativelanguage.googleapis.com',
    path
  );
  const models: any[] = data?.models ?? [];
  return models
    .map((m) => ({
      name: String(m.name ?? '').replace(/^models\//, ''),
      supportsGenerate: Array.isArray(m.supportedGenerationMethods)
        ? m.supportedGenerationMethods.includes('generateContent')
        : false,
    }))
    .filter((m) => m.name.startsWith('gemini'))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function httpsPostJson(
  hostname: string,
  path: string,
  body: unknown
): Promise<any> {
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname,
        path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          let parsed: any;
          try {
            parsed = JSON.parse(data);
          } catch {
            reject(new Error(`Non-JSON response: ${data.substring(0, 200)}`));
            return;
          }
          if (res.statusCode !== 200) {
            const msg = parsed?.error?.message ?? `HTTP ${res.statusCode}`;
            reject(new Error(msg));
            return;
          }
          resolve(parsed);
        });
      }
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function httpsGetJson(hostname: string, path: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      { hostname, path, method: 'GET' },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          let parsed: any;
          try {
            parsed = JSON.parse(data);
          } catch {
            reject(new Error(`Non-JSON response: ${data.substring(0, 200)}`));
            return;
          }
          if (res.statusCode !== 200) {
            const msg = parsed?.error?.message ?? `HTTP ${res.statusCode}`;
            reject(new Error(msg));
            return;
          }
          resolve(parsed);
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}
