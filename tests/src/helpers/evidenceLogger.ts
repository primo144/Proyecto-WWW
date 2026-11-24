import fs from 'node:fs';
import path from 'node:path';

const SENSITIVE_KEY_RE = /^(password|passwordhash|token|accesstoken|refreshtoken|authorization|secret|x-internal-service-token|emailapikey)$/i;
const JWT_RE = /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

export function sanitizePayload(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    if (JWT_RE.test(value)) return '***REDACTED_JWT***';
    if (value.startsWith('Bearer eyJ')) return 'Bearer ***REDACTED_JWT***';
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizePayload(item));
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY_RE.test(k)) {
        out[k] = '***REDACTED***';
      } else {
        out[k] = sanitizePayload(v);
      }
    }
    return out;
  }
  return value;
}

export interface EvidenceEntry {
  evidenceId: string;
  runId: string;
  testId: string;
  criteriaId: string;
  title: string;
  timestamp: string;
  environment: string;
  correlationIds: string[];
  status: 'PASSED' | 'FAILED' | 'SKIPPED';
  steps: Array<{
    action: string;
    request?: unknown;
    responseStatus?: number;
    responseBody?: unknown;
    durationMs?: number;
    correlationId?: string;
  }>;
  persistenceCheck?: unknown;
  notes?: string;
}

export class EvidenceRecorder {
  public readonly runId: string;
  public readonly dirPath: string;
  private counter = 0;
  private readonly entries: EvidenceEntry[] = [];

  constructor(suiteName: string) {
    const envRunId = process.env.RUN_ID;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    this.runId = envRunId && envRunId.trim().length > 0 ? envRunId.trim() : `RUN_${suiteName}_${stamp}`;
    this.dirPath = path.resolve(__dirname, '../../../docs/evidencias', this.runId);
    fs.mkdirSync(this.dirPath, { recursive: true });
  }

  public record(entry: Omit<EvidenceEntry, 'evidenceId' | 'runId' | 'timestamp' | 'environment'>): string {
    this.counter += 1;
    const evidenceId = `E${String(this.counter).padStart(2, '0')}`;
    const fullEntry: EvidenceEntry = {
      evidenceId,
      runId: this.runId,
      timestamp: new Date().toISOString(),
      environment: process.env.GATEWAY_URL || 'http://localhost:8080',
      ...(sanitizePayload(entry) as Omit<EvidenceEntry, 'evidenceId' | 'runId' | 'timestamp' | 'environment'>)
    };

    this.entries.push(fullEntry);
    const safeSlug = entry.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 40);
    const filePath = path.join(this.dirPath, `${evidenceId}_${entry.testId}_${safeSlug}.json`);
    fs.writeFileSync(filePath, JSON.stringify(fullEntry, null, 2), 'utf8');
    return filePath;
  }

  public writeSummary(): void {
    const summaryPath = path.join(this.dirPath, `summary_${Date.now()}.json`);
    const summary = {
      runId: this.runId,
      generatedAt: new Date().toISOString(),
      gatewayUrl: process.env.GATEWAY_URL || 'http://localhost:8080',
      total: this.entries.length,
      passed: this.entries.filter((e) => e.status === 'PASSED').length,
      failed: this.entries.filter((e) => e.status === 'FAILED').length,
      skipped: this.entries.filter((e) => e.status === 'SKIPPED').length,
      items: this.entries.map((e) => ({
        evidenceId: e.evidenceId,
        testId: e.testId,
        criteriaId: e.criteriaId,
        title: e.title,
        status: e.status,
        correlationIds: e.correlationIds
      }))
    };
    fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf8');
  }
}
