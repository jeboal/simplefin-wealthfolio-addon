import type { HostAPI } from '@wealthfolio/addon-sdk';
import { Alert, AlertDescription, Button } from '@wealthfolio/ui';
import { useEffect, useState } from 'react';
import {
  readDiagnostics,
  recordDiagnostic,
  type DiagnosticEntry,
} from '../lib/storage/diagnostics';

export interface DiagnosticLogProps {
  api: HostAPI;
}

export function DiagnosticLog({ api }: DiagnosticLogProps) {
  const [entries, setEntries] = useState<DiagnosticEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      setEntries(readDiagnostics());
    } catch (err) {
      const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      api.logger.error(`[simplefin] could not load diagnostic log: ${message}`);
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  async function exportLog() {
    setError(null);
    try {
      await api.files.openSaveDialog(
        JSON.stringify(readDiagnostics(), null, 2),
        'simplefin-diagnostics.json',
      );
    } catch (err) {
      const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      await recordDiagnostic(api, 'Export diagnostic log to this PC', err, {
        details: { request: { filename: 'simplefin-diagnostics.json' } },
      });
      setError(`Could not save diagnostic log: ${message}`);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-muted-foreground text-sm">
          Session-local errors include operation details and host request/response data. Credentials are redacted.
        </p>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={refresh} disabled={loading}>
            {loading ? 'Loading…' : 'Refresh'}
          </Button>
          <Button size="sm" variant="outline" onClick={exportLog} disabled={entries.length === 0}>
            Save log to this PC
          </Button>
        </div>
      </div>
      {error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {!loading && !error && entries.length === 0 && (
        <p className="text-muted-foreground text-sm">No errors have been recorded.</p>
      )}
      {entries.map((entry) => (
        <article key={`${entry.timestamp}-${entry.operation}`} className="space-y-1 rounded-md border p-3">
          <p className="text-sm font-medium">{entry.operation}</p>
          <p className="text-muted-foreground text-xs">{new Date(entry.timestamp).toLocaleString()}</p>
          <pre className="overflow-auto whitespace-pre-wrap break-words text-sm">{entry.message}</pre>
          {entry.stack && (
            <details>
              <summary className="cursor-pointer text-muted-foreground text-xs">Stack trace</summary>
              <pre className="overflow-auto whitespace-pre-wrap break-words pt-2 text-xs">
                {entry.stack}
              </pre>
            </details>
          )}
          {entry.details && (
            <details>
              <summary className="cursor-pointer text-muted-foreground text-xs">Request, response, and context</summary>
              <pre className="overflow-auto whitespace-pre-wrap break-words pt-2 text-xs">
                {entry.details}
              </pre>
            </details>
          )}
        </article>
      ))}
    </div>
  );
}
