import type { NetworkAPI, NetworkRequest, NetworkResponse } from '@wealthfolio/addon-sdk';

/**
 * Exchange a one-time SimpleFIN setup token for a permanent access URL.
 *
 * The setup token is base64 of the claim URL. It is single-use: if this fails
 * after the Bridge has consumed it, the user must generate a fresh token.
 */
export async function claimSetupToken(net: NetworkAPI, setupToken: string): Promise<string> {
  let claimUrl: string;
  try {
    claimUrl = atob(setupToken.trim());
  } catch {
    throw new Error('That does not look like a SimpleFIN setup token (not valid base64)');
  }

  if (!claimUrl.startsWith('https://')) {
    throw new Error('That does not look like a SimpleFIN setup token (no https claim URL)');
  }

  const request: NetworkRequest = { url: claimUrl, method: 'POST', body: '' };
  const requestDetails = {
    method: request.method,
    url: claimUrl,
    body: request.body,
  };
  let response: NetworkResponse;
  try {
    response = await net.request(request);
  } catch (error) {
    const failure = new Error('SimpleFIN setup-token claim network.request rejected');
    Object.assign(failure, { cause: error });
    Object.assign(failure, { diagnosticDetails: { request: requestDetails, response: null } });
    throw failure;
  }

  if (response.status === 403) {
    const failure = new Error(
      'The Bridge refused this setup token (HTTP 403). Setup tokens are single-use — ' +
        'generate a fresh one in the SimpleFIN Bridge dashboard.',
    );
    Object.assign(failure, { diagnosticDetails: { request: requestDetails, response } });
    throw failure;
  }
  if (response.status !== 200) {
    const failure = new Error(`Claiming the setup token failed: HTTP ${response.status}`);
    Object.assign(failure, { diagnosticDetails: { request: requestDetails, response } });
    throw failure;
  }

  return response.body.trim();
}
