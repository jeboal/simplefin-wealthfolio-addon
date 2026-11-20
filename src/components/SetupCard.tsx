import type { HostAPI } from '@wealthfolio/addon-sdk';
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Label,
  Textarea,
} from '@wealthfolio/ui';
import { useState } from 'react';
import { AUTH_SECRET_KEY } from '../lib/simplefin/client';
import { claimSetupToken } from '../lib/simplefin/claim';
import { splitAccessUrl } from '../lib/simplefin/url';
import { recordDiagnostic } from '../lib/storage/diagnostics';
import { DEFAULT_LOOKBACK_DAYS, DEFAULT_PAYMENT_KEYWORDS, DEFAULT_TRANSFER_KEYWORDS, writeConfig } from '../lib/storage/config';

export interface SetupCardProps {
  api: HostAPI;
  onConnected: () => void;
}

export function SetupCard({ api, onConnected }: SetupCardProps) {
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  async function handleConnect() {
    setError(null);
    setConnecting(true);
    let operation = 'claim setup token';
    const sensitiveValues = [token];
    let accessUrl: string | null = null;
    let request: unknown = null;
    try {
      accessUrl = await claimSetupToken(api.network, token);
      const { baseUrl, basicAuthSecret } = splitAccessUrl(accessUrl);
      sensitiveValues.push(accessUrl, basicAuthSecret);
      operation = 'store SimpleFIN credentials';
      request = { key: AUTH_SECRET_KEY, secret: basicAuthSecret };
      await api.secrets.set(AUTH_SECRET_KEY, basicAuthSecret);
      operation = 'save addon configuration';
      const config = {
        baseUrl,
        mappings: [],
        lookbackDays: DEFAULT_LOOKBACK_DAYS,
        paymentKeywords: DEFAULT_PAYMENT_KEYWORDS,
        transferKeywords: DEFAULT_TRANSFER_KEYWORDS,
      };
      request = config;
      await writeConfig(api, config);
      onConnected();
    } catch (err) {
      await recordDiagnostic(api, `Connect: ${operation}`, err, {
        sensitiveValues,
        details:
          operation === 'claim setup token'
            ? undefined
            : { request, ...(accessUrl ? { claimResponse: accessUrl } : {}) },
      });
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setConnecting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Connect to SimpleFIN</CardTitle>
        <CardDescription>
          Paste the setup token from your SimpleFIN Bridge dashboard to connect your accounts.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <div className="space-y-2">
          <Label htmlFor="setup-token">Setup token</Label>
          <Textarea
            id="setup-token"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            disabled={connecting}
          />
        </div>
        <Button onClick={handleConnect} disabled={connecting || !token.trim()}>
          {connecting ? 'Connecting…' : 'Connect'}
        </Button>
      </CardContent>
    </Card>
  );
}
