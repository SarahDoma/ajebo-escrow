import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';

export const randomHex = (n = 32) => randomBytes(n).toString('hex');
export const sha256hex = (hexOrStr, enc) =>
  createHash('sha256').update(enc === 'hex' ? Buffer.from(hexOrStr, 'hex') : hexOrStr).digest('hex');

/** Constant-time string comparison. */
export function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
