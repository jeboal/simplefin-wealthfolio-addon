import type { NetworkAPI, NetworkRequest, NetworkResponse } from '@wealthfolio/addon-sdk';
import { KEY_PREFIX } from '../constants';
import { parseAccountsResponse, type SfAccount, type SfBridgeError } from './parse';

/** Secret key holding base64(user:pass); resolved host-side by the network broker. */
export const AUTH_SECRET_KEY = `${KEY_PREFIX}.auth`;

export interface FetchAccountsOptions {
  /** Epoch seconds. */
  startDate?: number;
  /** Epoch seconds. */
  endDate?: number;
  pending?: boolean;
  accountIds?: string[];
  balancesOnly?: boolean;
}

function requestFailure(
  message: string,
  request: Record<string, unknown>,
  response: { status: number; headers: Record<string, string>; body: string } | null,
  cause?: unknown,
): Error {
  const error = new Error(message);
  if (cause !== undefined) Object.assign(error, { cause });
  Object.assign(error, { diagnosticDetails: { request, response } });
  return error;
}

export async function fetchAccounts(
  net: NetworkAPI,
  baseUrl: string,
  options: FetchAccountsOptions,
): Promise<{ accounts: SfAccount[]; errors: SfBridgeError[] }> {
  const url = new URL(`${baseUrl}/accounts`);

  if (options.startDate !== undefined) {
    url.searchParams.set('start-date', String(options.startDate));
  }
  if (options.endDate !== undefined) {
    url.searchParams.set('end-date', String(options.endDate));
  }
  if (options.pending) {
    url.searchParams.set('pending', '1');
  }
  if (options.balancesOnly) {
    url.searchParams.set('balances-only', '1');
  }
  for (const id of options.accountIds ?? []) {
    url.searchParams.append('account', id);
  }

  const request: NetworkRequest = {
    url: url.toString(),
    method: 'GET',
    auth: { type: 'basic', secretKey: AUTH_SECRET_KEY },
  };
  const requestDetails = {
    method: request.method,
    url: `${url.origin}${url.pathname}`,
    query: Object.fromEntries(url.searchParams.entries()),
    auth: request.auth,
  };

  let response: NetworkResponse;
  try {
    response = await net.request(request);
  } catch (error) {
    throw requestFailure('SimpleFIN network.request(GET /accounts) rejected', requestDetails, null, error);
  }

  if (response.status !== 200) {
    throw requestFailure(
      `SimpleFIN Bridge returned HTTP ${response.status}`,
      requestDetails,
      response,
    );
  }

  let payload: unknown;
  try {
    payload = JSON.parse(response.body);
  } catch (error) {
    throw requestFailure(
      'SimpleFIN Bridge returned a body that is not valid JSON',
      requestDetails,
      response,
      error,
    );
  }

  try {
    // Bridge errors are returned, not thrown: a failing institution must not
    // prevent the healthy accounts in the same response from syncing.
    return parseAccountsResponse(payload);
  } catch (error) {
    throw requestFailure(
      'SimpleFIN accounts response could not be parsed',
      requestDetails,
      response,
      error,
    );
  }
}
