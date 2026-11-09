import { MockLightning } from './mock.js';
import { LndLightning } from './lnd.js';

export function createLightning(env = process.env) {
  if ((env.LN_BACKEND || 'mock') === 'lnd') {
    return new LndLightning({
      url: env.LND_REST_URL,
      macaroonHex: env.LND_MACAROON_HEX,
      tlsCertPath: env.LND_TLS_CERT_PATH,
    });
  }
  return new MockLightning();
}
