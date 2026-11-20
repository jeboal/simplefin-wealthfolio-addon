import { describe, expect, it } from 'vitest';
import { createMockHost } from '../../test/mockHost';
import { readDiagnostics, recordDiagnostic } from './diagnostics';

describe('diagnostics', () => {
  it('keeps diagnostics in session memory and redacts credentials and claim tokens', async () => {
    const host = createMockHost();
    const error = new Error(
      'request failed for https://user:pass@bridge.example/claim/secret?token=secret',
    );
    await recordDiagnostic(host.api, 'SimpleFIN account fetch', error, {
      sensitiveValues: ['secret'],
      details: {
        request: {
          url: 'https://user:pass@bridge.example/accounts',
          query: { account: 'ACT-1' },
        },
      },
    });

    const [entry] = readDiagnostics();
    expect(entry).toMatchObject({
      operation: 'SimpleFIN account fetch',
      message: 'Error: request failed for https://bridge.example/claim/[redacted]',
    });
    expect(entry.stack).toContain('Error: request failed');
    expect(entry.stack).not.toContain('user:pass');
    expect(entry.stack).not.toContain('secret');
    expect(entry.details).toContain('"account": "ACT-1"');
    expect(entry.details).not.toContain('user:pass');
    expect(host.api.storage.get).not.toHaveBeenCalled();
    expect(host.api.storage.set).not.toHaveBeenCalled();
  });

  it('redacts secret-bearing fields from host request and response details', async () => {
    const host = createMockHost();
    await recordDiagnostic(host.api, 'host activity import', new Error('HTTP 400'), {
      details: {
        request: { authorization: 'Bearer sensitive', body: [{ amount: '-1.00' }] },
        response: {
          status: 400,
          body: '{"error":"invalid account mapping","access_token":"sensitive"}',
        },
      },
    });

    const [entry] = readDiagnostics();
    expect(entry.details).toContain('[redacted]');
    expect(entry.details).not.toContain('sensitive');
    expect(entry.details).toContain('invalid account mapping');
  });
});
