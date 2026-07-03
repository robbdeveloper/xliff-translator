import { useCallback, useRef, useState } from 'react';
import JSZip from 'jszip';
import type { FileSummary, ProjectStats, TranslationProgress } from './api';
import {
  diagnoseProvider,
  exportSession,
  translateSession,
  updateUnit,
  uploadFiles,
} from './api';

const API_KEY_STORAGE = 'xliff-translator-api-key';
const PROVIDER_STORAGE = 'xliff-translator-provider';

function statusClass(status: string): string {
  switch (status) {
    case 'translated':
      return 'badge success';
    case 'skipped':
      return 'badge muted';
    case 'needs_review':
      return 'badge warning';
    case 'error':
      return 'badge error';
    default:
      return 'badge pending';
  }
}

export default function App() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [files, setFiles] = useState<FileSummary[]>([]);
  const [stats, setStats] = useState<ProjectStats | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [loading, setLoading] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [progress, setProgress] = useState<TranslationProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [provider, setProvider] = useState<'openai' | 'claude'>(() =>
    (localStorage.getItem(PROVIDER_STORAGE) as 'openai' | 'claude') ?? 'openai'
  );
  const [apiKey, setApiKey] = useState(() => localStorage.getItem(API_KEY_STORAGE) ?? '');
  const [model, setModel] = useState(provider === 'openai' ? 'gpt-4o-mini' : 'claude-sonnet-4-20250514');
  const [batchSize, setBatchSize] = useState(1);
  const [diagnoseResult, setDiagnoseResult] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(async (fileList: FileList | File[]) => {
    const arr = Array.from(fileList).filter((f) =>
      f.name.toLowerCase().endsWith('.xliff') || f.name.toLowerCase().endsWith('.xlf')
    );
    if (arr.length === 0) {
      setError('Please drop .xliff or .xlf files');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await uploadFiles(arr);
      setSessionId(result.sessionId);
      setFiles(result.files);
      setStats(result.stats);
      setSelectedFile(result.files[0]?.fileName ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setLoading(false);
    }
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      if (e.dataTransfer.files.length) void handleFiles(e.dataTransfer.files);
    },
    [handleFiles]
  );

  const startTranslation = async () => {
    if (!sessionId || !apiKey) {
      setError('Upload files and enter an API key first');
      return;
    }
    localStorage.setItem(API_KEY_STORAGE, apiKey.trim());
    localStorage.setItem(PROVIDER_STORAGE, provider);
    setTranslating(true);
    setError(null);
    setProgress(null);
    setDiagnoseResult(null);
    try {
      const result = await translateSession(sessionId, {
        provider,
        apiKey: apiKey.trim(),
        model,
        batchSize,
        onProgress: setProgress,
      });
      setStats(result.stats);
      setFiles((prev) =>
        prev.map((file) => {
          const updated = result.files.find((f) => f.fileName === file.fileName);
          if (!updated) return file;
          return {
            ...file,
            units: file.units.map((unit) => {
              const match = updated.units.find((u) => u.id === unit.id);
              if (!match) return unit;
              return {
                ...unit,
                translatedTarget: match.translatedTarget ?? unit.translatedTarget,
                status: match.status,
                warnings: match.warnings,
              };
            }),
          };
        })
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Translation failed');
    } finally {
      setTranslating(false);
    }
  };

  const testConnection = async () => {
    if (!apiKey.trim()) {
      setError('Enter an API key first');
      return;
    }
    setDiagnoseResult('Testing connection…');
    setError(null);
    try {
      const result = await diagnoseProvider(provider, apiKey.trim());
      if (provider === 'openai') {
        if (result.openaiStatus === 200) {
          setDiagnoseResult('OpenAI connection OK');
        } else if (result.openaiReachable) {
          setDiagnoseResult(`Network OK — ${String(result.openaiError ?? `OpenAI status ${result.openaiStatus}`)}`);
        } else {
          setDiagnoseResult(String(result.openaiError ?? 'Cannot reach OpenAI'));
        }
      } else if (result.claudeStatus === 200) {
        setDiagnoseResult('Claude connection OK');
      } else if (result.claudeReachable) {
        setDiagnoseResult(`Network OK — ${String(result.claudeError ?? `Claude status ${result.claudeStatus}`)}`);
      } else {
        setDiagnoseResult(String(result.claudeError ?? 'Cannot reach Claude'));
      }
    } catch (e) {
      setDiagnoseResult(e instanceof Error ? e.message : 'Connection test failed');
    }
  };

  const downloadZip = async () => {
    if (!sessionId) return;
    const exported = await exportSession(sessionId);
    const zip = new JSZip();
    for (const file of exported) {
      zip.file(file.fileName, file.content);
    }
    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'translated-xliff.zip';
    a.click();
    URL.revokeObjectURL(url);
  };

  const saveUnitEdit = async (fileName: string, unitId: string, target: string) => {
    if (!sessionId) return;
    await updateUnit(sessionId, fileName, unitId, target);
    setFiles((prev) =>
      prev.map((f) =>
        f.fileName === fileName
          ? {
              ...f,
              units: f.units.map((u) =>
                u.id === unitId ? { ...u, translatedTarget: target, status: 'translated' } : u
              ),
            }
          : f
      )
    );
  };

  const currentFile = files.find((f) => f.fileName === selectedFile);
  const filteredUnits =
    currentFile?.units.filter((u) => {
      if (!filter) return true;
      const q = filter.toLowerCase();
      return (
        u.source.toLowerCase().includes(q) ||
        u.id.toLowerCase().includes(q) ||
        u.resname.toLowerCase().includes(q) ||
        (u.translatedTarget ?? u.target).toLowerCase().includes(q)
      );
    }) ?? [];

  return (
    <div className="app">
      <header className="header">
        <div>
          <p className="eyebrow">WPML XLIFF 1.2</p>
          <h1>XLIFF Translator</h1>
          <p className="subtitle">
            Drop WPML export jobs, translate with AI, review, and download ready-to-import files.
          </p>
        </div>
        {stats && (
          <div className="stats-grid">
            <div className="stat"><span>{stats.total}</span><small>Total units</small></div>
            <div className="stat"><span>{stats.translated}</span><small>Translated</small></div>
            <div className="stat"><span>{stats.skipped}</span><small>Skipped</small></div>
            <div className="stat"><span>{stats.needsReview + stats.errors}</span><small>Review</small></div>
          </div>
        )}
      </header>

      <main className="layout">
        <section className="panel sidebar">
          <div
            className={`dropzone ${dragOver ? 'active' : ''}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".xliff,.xlf"
              multiple
              hidden
              onChange={(e) => e.target.files && void handleFiles(e.target.files)}
            />
            <strong>{loading ? 'Parsing…' : 'Drop XLIFF files here'}</strong>
            <span>or click to browse · multiple files supported</span>
          </div>

          <div className="settings">
            <label>
              Provider
              <select
                value={provider}
                onChange={(e) => {
                  const p = e.target.value as 'openai' | 'claude';
                  setProvider(p);
                  setModel(p === 'openai' ? 'gpt-4o-mini' : 'claude-sonnet-4-20250514');
                }}
              >
                <option value="openai">OpenAI</option>
                <option value="claude">Claude</option>
              </select>
            </label>
            <label>
              Model
              <input value={model} onChange={(e) => setModel(e.target.value)} />
            </label>
            <label>
              Batch size
              <input
                type="number"
                min={1}
                max={8}
                value={batchSize}
                onChange={(e) => setBatchSize(Math.max(1, Math.min(8, Number(e.target.value) || 1)))}
              />
            </label>
            <label>
              API Key
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={provider === 'openai' ? 'sk-…' : 'sk-ant-…'}
              />
            </label>
            <button className="secondary" type="button" onClick={() => void testConnection()}>
              Test API Connection
            </button>
            {diagnoseResult && <p className="diagnose-result">{diagnoseResult}</p>}
            <button
              className="primary"
              disabled={!sessionId || translating || !apiKey}
              onClick={() => void startTranslation()}
            >
              {translating ? 'Translating…' : 'Start Translation'}
            </button>
            <button className="secondary" disabled={!sessionId} onClick={() => void downloadZip()}>
              Download ZIP
            </button>
          </div>

          {progress && translating && (
            <div className="progress-card">
              <div className="progress-bar">
                <div
                  style={{
                    width: `${progress.total ? (progress.completed / progress.total) * 100 : 0}%`,
                  }}
                />
              </div>
              <p>
                {progress.completed} / {progress.total} translated
                {progress.skipped > 0 ? ` · ${progress.skipped} skipped` : ''}
                {progress.failed > 0 ? ` · ${progress.failed} failed` : ''}
              </p>
              {progress.currentFile && (
                <p className="progress-detail">Working on {progress.currentFile}</p>
              )}
              {progress.lastError && (
                <p className="progress-error">Last error: {progress.lastError}</p>
              )}
            </div>
          )}

          {error && <div className="error-banner">{error}</div>}

          <div className="file-list">
            <h3>Files ({files.length})</h3>
            {files.map((file) => (
              <button
                key={file.fileName}
                className={`file-item ${selectedFile === file.fileName ? 'selected' : ''}`}
                onClick={() => setSelectedFile(file.fileName)}
              >
                <span>{file.fileName}</span>
                <small>{file.unitCount} units</small>
              </button>
            ))}
          </div>
        </section>

        <section className="panel content">
          {currentFile ? (
            <>
              <div className="content-header">
                <div>
                  <h2>{currentFile.fileName}</h2>
                  <p>
                    {currentFile.sourceLanguage} → {currentFile.targetLanguage}
                    {currentFile.referenceUrl ? ` · ${currentFile.referenceUrl}` : ''}
                  </p>
                </div>
                <input
                  className="search"
                  placeholder="Filter units…"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                />
              </div>
              <div className="units">
                {filteredUnits.map((unit) => (
                  <article key={unit.id} className="unit-card">
                    <div className="unit-meta">
                      <code>{unit.id}</code>
                      <span className={statusClass(unit.status)}>{unit.status}</span>
                      {unit.skipReason && <span className="badge muted">{unit.skipReason}</span>}
                    </div>
                    <p className="unit-label">{unit.resname}{unit.group ? ` · ${unit.group}` : ''}</p>
                    <div className="unit-columns">
                      <div>
                        <small>Source</small>
                        <pre>{unit.source}</pre>
                      </div>
                      <div>
                        <small>Target</small>
                        <textarea
                          defaultValue={unit.translatedTarget ?? unit.target}
                          rows={Math.min(12, Math.max(3, (unit.source.match(/\n/g)?.length ?? 0) + 2))}
                          onBlur={(e) =>
                            void saveUnitEdit(currentFile.fileName, unit.id, e.target.value)
                          }
                        />
                      </div>
                    </div>
                    {unit.warnings.length > 0 && (
                      <ul className="warnings">
                        {unit.warnings.map((w) => (
                          <li key={w}>{w}</li>
                        ))}
                      </ul>
                    )}
                  </article>
                ))}
              </div>
            </>
          ) : (
            <div className="empty-state">
              <h2>Upload XLIFF files to begin</h2>
              <p>Supports WPML XLIFF 1.2 exports with Elementor, ACF, pages, and templates.</p>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
