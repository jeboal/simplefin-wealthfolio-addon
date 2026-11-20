import type { HostAPI } from '@wealthfolio/addon-sdk';

export interface DiagnosticEntry {
  timestamp: string;
  operation: string;
  message: string;
  stack: string | null;
  details: string | null;
}

interface FormattedError {
  message: string;
  stack: string | null;
  details: unknown;
}

const DIAGNOSTIC_LIMIT = 20;
let diagnosticEntries: DiagnosticEntry[] = [];

export interface DiagnosticOptions {
  sensitiveValues?: string[];
  details?: unknown;
}

function errorDetails(error: unknown): FormattedError {
  if (error instanceof Error) {
    const cause = (error as Error & { cause?: unknown }).cause;
    const causeMessage =
      cause === undefined
        ? ''
        : `\nCaused by: ${cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause)}`;
    const value = error as Error & { diagnosticDetails?: unknown };
    const details =
      value.diagnosticDetails ??
      ['code', 'status', 'statusCode', 'request', 'response', 'data', 'body', 'details', 'cause'].reduce<
        Record<string, unknown>
      >((found, key) => {
        if (key in error) {
          try {
            found[key] = (error as Error & Record<string, unknown>)[key];
          } catch (readError) {
            found[key] = `[could not read: ${String(readError)}]`;
          }
        }
        return found;
      }, {});
    return {
      message: `${error.name}: ${error.message}${causeMessage}`,
      stack: error.stack ?? null,
      details,
    };
  }

  if (typeof error === 'object' && error !== null) {
    const value = error as { name?: unknown; message?: unknown; code?: unknown; stack?: unknown };
    const parts = [value.name, value.message, value.code]
      .filter((part): part is string | number => typeof part === 'string' || typeof part === 'number')
      .map(String);
    return {
      message: parts.length > 0 ? parts.join(' — ') : String(error),
      stack: typeof value.stack === 'string' ? value.stack : null,
      details: error,
    };
  }

  return { message: String(error), stack: null, details: null };
}

function redactText(text: string, sensitiveValues: string[]): string {
  let result = text;
  for (const value of sensitiveValues) {
    if (value) result = result.split(value).join('[redacted]');
  }

  result = result
    .replace(/(authorization\s*[:=]\s*(?:bearer|basic)\s+)[^\s,;]+/gi, '$1[redacted]')
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9+/_=-]{8,}/gi, '$1 [redacted]');

  return result.replace(/https?:\/\/[^\s"'<>]+/gi, (match) => {
    const trailing = match.match(/[),.;]+$/)?.[0] ?? '';
    const value = trailing ? match.slice(0, -trailing.length) : match;
    try {
      const url = new URL(value);
      url.username = '';
      url.password = '';
      url.search = '';
      url.hash = '';
      url.pathname = url.pathname.replace(/(\/claim\/)[^/]+/i, '$1[redacted]');
      return `${url.origin}${url.pathname}${trailing}`;
    } catch {
      return '[redacted URL]';
    }
  });
}

function redactValue(value: unknown, sensitiveValues: string[], seen = new WeakSet<object>()): unknown {
  if (typeof value === 'string') {
    const text = redactText(value, sensitiveValues);
    try {
      const parsed: unknown = JSON.parse(text);
      if (typeof parsed === 'object' && parsed !== null) {
        return redactValue(parsed, sensitiveValues, seen);
      }
    } catch {
      return text;
    }
    return text;
  }
  if (Array.isArray(value)) return value.map((item) => redactValue(item, sensitiveValues, seen));
  if (typeof value !== 'object' || value === null) return value;
  if (seen.has(value)) return '[circular reference]';
  seen.add(value);

  const clean: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    clean[key] = /authorization|cookie|password|token|secret|credential/i.test(key)
      ? '[redacted]'
      : redactValue(item, sensitiveValues, seen);
  }
  return clean;
}

function formatDetails(value: unknown, sensitiveValues: string[]): string | null {
  if (value === null || value === undefined) return null;
  try {
    if (typeof value === 'string') {
      try {
        return JSON.stringify(
          redactValue(JSON.parse(value), sensitiveValues),
          null,
          2,
        );
      } catch {
        return redactText(value, sensitiveValues);
      }
    }
    const redacted = redactValue(value, sensitiveValues);
    if (
      typeof redacted === 'object' &&
      redacted !== null &&
      !Array.isArray(redacted) &&
      Object.keys(redacted).length === 0
    ) {
      return null;
    }
    return typeof redacted === 'string' ? redacted : JSON.stringify(redacted, null, 2);
  } catch (error) {
    return `Could not format diagnostic details: ${String(error)}`;
  }
}

export function readDiagnostics(): DiagnosticEntry[] {
  return [...diagnosticEntries];
}

export async function recordDiagnostic(
  api: HostAPI,
  operation: string,
  error: unknown,
  options: DiagnosticOptions = {},
): Promise<void> {
  const sensitiveValues = options.sensitiveValues ?? [];
  const formattedError = errorDetails(error);
  const errorContext =
    typeof formattedError.details === 'object' && formattedError.details !== null
      ? formattedError.details
      : { error: formattedError.details };
  const explicitContext =
    typeof options.details === 'object' && options.details !== null && !Array.isArray(options.details)
      ? options.details
      : options.details === undefined
        ? {}
        : { context: options.details };
  const entry: DiagnosticEntry = {
    timestamp: new Date().toISOString(),
    operation,
    message: redactText(formattedError.message, sensitiveValues),
    stack: formattedError.stack ? redactText(formattedError.stack, sensitiveValues) : null,
    details: formatDetails({ ...errorContext, ...explicitContext }, sensitiveValues),
  };

  diagnosticEntries = [entry, ...diagnosticEntries].slice(0, DIAGNOSTIC_LIMIT);

  api.logger.error(
    `[simplefin] ${operation}: ${entry.message}` +
      `${entry.stack ? `\n${entry.stack}` : ''}` +
      `${entry.details ? `\nDetails:\n${entry.details}` : ''}`,
  );
}
