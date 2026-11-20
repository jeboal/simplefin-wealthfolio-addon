import { describe, expect, it, vi } from 'vitest';
import { createMockHost } from '../../test/mockHost';
import { appendRun, HISTORY_LIMIT, HistoryPersistenceError, readHistory } from './history';

const run = (startedAt: string) => ({
  startedAt,
  finishedAt: startedAt,
  accounts: [],
  bridgeErrors: [],
});

describe('history', () => {
  it('returns an empty list when nothing is stored', async () => {
    const host = createMockHost();
    expect(await readHistory(host.api)).toEqual([]);
  });

  it('stores newest first', async () => {
    const host = createMockHost();
    await appendRun(host.api, run('2026-08-01T00:00:00Z'));
    await appendRun(host.api, run('2026-08-02T00:00:00Z'));
    const history = await readHistory(host.api);
    expect(history[0].startedAt).toBe('2026-08-02T00:00:00Z');
  });

  it('bounds the history so the value stays under the host size cap', async () => {
    const host = createMockHost();
    for (let i = 0; i < HISTORY_LIMIT + 5; i += 1) {
      await appendRun(host.api, run(`2026-08-01T00:00:${String(i).padStart(2, '0')}Z`));
    }
    expect(await readHistory(host.api)).toHaveLength(HISTORY_LIMIT);
  });

  it('reports the exact storage write and preserves its request and host error', async () => {
    const host = createMockHost();
    const hostError = Object.assign(new Error('The operation could not be completed.'), {
      code: 'internal_error',
      request: { operation: 'set' },
      response: { code: 'internal_error', detail: 'storage unavailable' },
    });
    host.api.storage.set = vi.fn(async () => {
      throw hostError;
    }) as never;

    const attemptedRun = run('2026-08-01T00:00:00Z');
    const caught: unknown = await appendRun(host.api, attemptedRun).catch((error: unknown) => error);

    expect(caught).toBeInstanceOf(HistoryPersistenceError);
    if (!(caught instanceof HistoryPersistenceError)) throw new Error('Expected history persistence error');
    const error = caught;
    expect(error.message).toContain('write sync run history to Wealthfolio storage');
    expect(error.message).toContain('internal_error');
    expect(error.run).toEqual(attemptedRun);
    expect(error.diagnosticDetails).toMatchObject({
      phase: 'write',
      storageKey: 'simplefin.history',
      attemptedRun,
      request: {
        operation: 'api.storage.set',
        key: 'simplefin.history',
        value: JSON.stringify([attemptedRun]),
      },
      serializedBytes: new TextEncoder().encode(JSON.stringify([attemptedRun])).length,
      hostError: {
        code: 'internal_error',
        request: { operation: 'set' },
        response: { code: 'internal_error', detail: 'storage unavailable' },
      },
    });
  });

  it('identifies a history read failure separately from a write failure', async () => {
    const host = createMockHost();
    host.api.storage.get = vi.fn(async () => {
      throw Object.assign(new Error('read rejected'), { code: 'internal_error' });
    }) as never;

    await expect(appendRun(host.api, run('2026-08-01T00:00:00Z'))).rejects.toMatchObject({
      name: 'HistoryPersistenceError',
      diagnosticDetails: {
        phase: 'read',
        request: { operation: 'api.storage.get', key: 'simplefin.history' },
      },
    });
  });
});
