import cors from 'cors';
import express from 'express';
import multer from 'multer';
import {
  createProvider,
  exportTranslatedFiles,
  fetchWithTimeout,
  formatFetchError,
  getProjectStats,
  loadXliffFiles,
  parseApiHttpError,
  ProviderError,
  translateProject,
  updateUnitTarget,
  validateTransUnit,
} from '@xliff-translator/core';
import type { LoadedProject } from '@xliff-translator/core';

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

app.use(cors());
app.use(express.json({ limit: '50mb' }));

const sessions = new Map<string, LoadedProject>();

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/api/diagnose', async (req, res) => {
  await handleDiagnose(
    String(req.query.provider ?? 'openai'),
    String(req.query.apiKey ?? '').trim(),
    res
  );
});

app.post('/api/diagnose', async (req, res) => {
  const body = req.body as { provider?: string; apiKey?: string };
  await handleDiagnose(
    String(body.provider ?? 'openai'),
    String(body.apiKey ?? '').trim(),
    res
  );
});

async function handleDiagnose(
  provider: string,
  apiKey: string,
  res: express.Response
) {
  const result: Record<string, unknown> = {
    node: process.version,
    provider,
    hasApiKey: apiKey.length > 0,
  };

  try {
    const ping = await fetchWithTimeout('https://api.openai.com/v1/models', {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    });
    result.openaiReachable = true;
    result.openaiStatus = ping.status;
    if (!ping.ok && apiKey) {
      const body = await ping.text();
      result.openaiError = parseApiHttpError(ping.status, body, 'OpenAI').message;
    }
  } catch (error) {
    result.openaiReachable = false;
    result.openaiError = formatFetchError(error);
  }

  if (provider === 'claude' && apiKey) {
    try {
      const ping = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 16,
          messages: [{ role: 'user', content: 'Reply with OK' }],
        }),
      });
      result.claudeReachable = true;
      result.claudeStatus = ping.status;
      if (!ping.ok) {
        const body = await ping.text();
        result.claudeError = parseApiHttpError(ping.status, body, 'Claude').message;
      }
    } catch (error) {
      result.claudeReachable = false;
      result.claudeError = formatFetchError(error);
    }
  }

  res.json(result);
}

app.post('/api/upload', upload.array('files'), (req, res) => {
  const files = (req.files as Array<{ originalname: string; buffer: Buffer }> | undefined) ?? [];
  if (files.length === 0) {
    res.status(400).json({ error: 'No files uploaded' });
    return;
  }

  const xliffFiles = files
    .filter((f) => f.originalname.toLowerCase().endsWith('.xliff') || f.originalname.toLowerCase().endsWith('.xlf'))
    .map((f) => ({
      fileName: f.originalname,
      content: f.buffer.toString('utf-8'),
    }));

  if (xliffFiles.length === 0) {
    res.status(400).json({ error: 'No valid XLIFF files found' });
    return;
  }

  try {
    const project = loadXliffFiles(xliffFiles);
    const id = crypto.randomUUID();
    sessions.set(id, project);

    const stats = getProjectStats(project);
    res.json({
      sessionId: id,
      files: project.files.map((f) => ({
        fileName: f.info.fileName,
        sourceLanguage: f.info.sourceLanguage,
        targetLanguage: f.info.targetLanguage,
        referenceUrl: f.info.referenceUrl,
        postType: f.info.postType,
        wordCount: f.info.wordCount,
        unitCount: f.parsed.transUnits.length,
        units: f.parsed.transUnits.map((u) => ({
          id: u.meta.id,
          resname: u.meta.resname,
          group: u.meta.group,
          source: u.source,
          target: u.target,
          translatedTarget: u.translatedTarget,
          status: u.status,
          skipReason: u.skipReason,
          warnings: u.warnings,
        })),
      })),
      stats,
    });
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : 'Failed to parse XLIFF files',
    });
  }
});

app.post('/api/translate', async (req, res) => {
  const {
    sessionId: sid,
    provider = 'openai',
    apiKey,
    model,
    sourceLanguage,
    targetLanguage,
    batchSize,
  } = req.body as {
    sessionId?: string;
    provider?: 'openai' | 'claude';
    apiKey?: string;
    model?: string;
    sourceLanguage?: string;
    targetLanguage?: string;
    batchSize?: number;
  };

  if (!sid || !sessions.has(sid)) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }
  if (!apiKey?.trim()) {
    res.status(400).json({ error: 'API key is required' });
    return;
  }

  const normalizedKey = apiKey.trim();

  const project = sessions.get(sid)!;
  const srcLang = sourceLanguage ?? project.files[0]?.info.sourceLanguage ?? 'it';
  const tgtLang = targetLanguage ?? project.files[0]?.info.targetLanguage ?? 'en';

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const send = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    const flushable = res as unknown as { flush?: () => void };
    flushable.flush?.();
  };

  send('progress', {
    total: 0,
    completed: 0,
    skipped: 0,
    failed: 0,
    status: 'starting',
  });

  try {
    const translationProvider = createProvider(provider, normalizedKey, model);
    await translateProject(project, {
      provider: translationProvider,
      sourceLanguage: srcLang,
      targetLanguage: tgtLang,
      batchSize,
      onProgress: (progress) => send('progress', progress),
    });

    sessions.set(sid, project);
    const stats = getProjectStats(project);
    send('complete', {
      stats,
      files: project.files.map((f) => ({
        fileName: f.info.fileName,
        units: f.parsed.transUnits.map((u) => ({
          id: u.meta.id,
          translatedTarget: u.translatedTarget,
          status: u.status,
          warnings: u.warnings,
        })),
      })),
    });
  } catch (error) {
    const message =
      error instanceof ProviderError || error instanceof Error
        ? error.message
        : 'Translation failed';
    console.error('[translate]', message);
    send('error', { message });
  } finally {
    res.end();
  }
});

app.patch('/api/session/:sessionId/unit', (req, res) => {
  const { sessionId: sid } = req.params;
  const { fileName, unitId, target } = req.body as {
    fileName?: string;
    unitId?: string;
    target?: string;
  };

  if (!sid || !sessions.has(sid)) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }
  if (!fileName || !unitId || target === undefined) {
    res.status(400).json({ error: 'fileName, unitId, and target are required' });
    return;
  }

  const project = sessions.get(sid)!;
  updateUnitTarget(project, fileName, unitId, target);
  sessions.set(sid, project);
  res.json({ ok: true });
});

app.get('/api/session/:sessionId/export', (req, res) => {
  const { sessionId: sid } = req.params;
  if (!sid || !sessions.has(sid)) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  const project = sessions.get(sid)!;
  const exported = exportTranslatedFiles(project);
  res.json({ files: exported });
});

app.get('/api/session/:sessionId/validate', (req, res) => {
  const { sessionId: sid } = req.params;
  if (!sid || !sessions.has(sid)) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  const project = sessions.get(sid)!;
  const issues = project.files.flatMap((f) =>
    f.parsed.transUnits.flatMap((u) => validateTransUnit(u, f.info.fileName))
  );
  res.json({ issues });
});

const PORT = Number(process.env.PORT ?? 3847);
app.listen(PORT, () => {
  console.log(`XLIFF Translator server running on http://localhost:${PORT}`);
});
