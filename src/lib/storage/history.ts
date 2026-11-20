import type { HostAPI } from '@wealthfolio/addon-sdk';
import type { SfBridgeError } from '../simplefin/parse';
import { recordDiagnostic } from './diagnostics';
import { storageKey } from './keys';

export interface AccountRunResult {
  sfAccountId: string;
  sfAccountName: string;
  orgName: string;
  wfAccountId: string;
  mode: 'CASH' | 'HOLDINGS';
  /** null when the account failed before anything was counted. */
  imported: number | null;
  skipped: number | null;
  duplicates: number | null;
  /** Populated only when this account failed; other accounts are unaffected. */
  error: string | null;
  /** Set when SimpleFIN and Wealthfolio balances disagree after the run. */
  balanceMismatch: { simplefin: string; wealthfolio: string } | null;
  /**
   * Why the balance check couldn't run, or null when it did run and agreed.
   * A clean run and a skipped check both leave `balanceMismatch` null, and
   * reporting them the same way lets a credit card — which Wealthfolio never
   * returns a balance for — read as "verified" when nothing was verified.
   *
   * Optional because runs recorded before this field existed carry neither
   * value; `undefined` there means "unknown", not "checked".
   */
  balanceUnchecked?: string | null;
  /**
   * Non-fatal problem worth showing the user — the account still synced.
   * Distinct from `error`, which means the account produced nothing.
   */
  warning?: string | null;
}

export interface SyncRun {
  startedAt: string;
  finishedAt: string;
  accounts: AccountRunResult[];
  bridgeErrors: SfBridgeError[];
}

/**
 * Runs retained. The whole history is one storage value, and the host caps
 * values at ~250 KB; 20 runs across a realistic account count stays far below
 * that while covering enough history to spot a recurring failure.
 */
export const HISTORY_LIMIT = 20;

const HISTORY_KEY = storageKey('history');

function snapshotError(error: unknown): Record<string, unknown> {
  if ((typeof error !== 'object' && typeof error !== 'function') || error === null) {
    return { value: error };
  }

  const value = error as Record<string, unknown>;
  const keys = new Set([
    ...Object.getOwnPropertyNames(error),
    ...Object.keys(value),
    'name',
    'message',
    'stack',
    'code',
    'status',
    'statusCode',
    'request',
    'response',
    'data',
    'body',
    'details',
    'cause',
  ]);
  const snapshot: Record<string, unknown> = {};
  for (const key of keys) {
    try {
      const property = value[key];
      if (property !== undefined) snapshot[key] = property;
    } catch (readError) {
      snapshot[key] = `[could not read: ${String(readError)}]`;
    }
  }
  return snapshot;
}

export class HistoryPersistenceError extends Error {
  readonly diagnosticDetails: Record<string, unknown>;
  readonly run: SyncRun;

  constructor(
    phase: 'read' | 'serialize' | 'write',
    cause: unknown,
    run: SyncRun,
    details: Record<string, unknown> = {},
  ) {
    const operation = {
      read: 'read sync run history from Wealthfolio storage',
      serialize: 'serialize sync run history',
      write: 'write sync run history to Wealthfolio storage',
    }[phase];
    const causeDetails = snapshotError(cause);
    const causeMessage = String(causeDetails.message ?? causeDetails.value ?? cause);
    const code =
      causeDetails.code !== undefined
        ? ` (code: ${String(causeDetails.code)})`
        : '';
    super(`Could not ${operation}: ${causeMessage}${code}`);
    this.name = 'HistoryPersistenceError';
    this.run = run;
    this.diagnosticDetails = {
      phase,
      storageKey: HISTORY_KEY,
      hostError: causeDetails,
      attemptedRun: run,
      ...details,
    };
  }
}

export async function readHistory(api: HostAPI): Promise<SyncRun[]> {
  const raw = await api.storage.get(HISTORY_KEY);
  if (!raw) return [];

  try {
    return JSON.parse(raw) as SyncRun[];
  } catch (error) {
    await recordDiagnostic(api, 'Read sync history found invalid JSON', error, {
      details: { response: { storedHistory: raw } },
    });
    return [];
  }
}

export async function appendRun(api: HostAPI, run: SyncRun): Promise<void> {
  let history: SyncRun[];
  try {
    history = await readHistory(api);
  } catch (error) {
    throw new HistoryPersistenceError('read', error, run, {
      request: { operation: 'api.storage.get', key: HISTORY_KEY },
    });
  }
  const next = [run, ...history].slice(0, HISTORY_LIMIT);
  let serialized: string;
  try {
    serialized = JSON.stringify(next);
  } catch (error) {
    throw new HistoryPersistenceError('serialize', error, run, {
      request: { operation: 'JSON.stringify', key: HISTORY_KEY },
      historyEntries: next.length,
      history: next,
    });
  }

  const serializedBytes = new TextEncoder().encode(serialized).length;
  try {
    await api.storage.set(HISTORY_KEY, serialized);
  } catch (error) {
    throw new HistoryPersistenceError('write', error, run, {
      request: { operation: 'api.storage.set', key: HISTORY_KEY, value: serialized },
      historyEntries: next.length,
      serializedBytes,
    });
  }
}
