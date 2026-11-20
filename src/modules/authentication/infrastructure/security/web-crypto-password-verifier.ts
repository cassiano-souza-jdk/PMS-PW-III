import type {
  PasswordHashResult,
  PasswordVerifierPort,
} from '../../application/ports/password-verifier.port';
import { PASSWORD_VERIFIER_ALGORITHM, type LocalCredential } from '../../domain/local-credential';

const SHA256_INITIAL_H = [
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
] as const;

const SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
] as const;

function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex;
}

function generateSaltHex(): string {
  if (
    typeof globalThis.crypto !== 'undefined' &&
    typeof globalThis.crypto.getRandomValues === 'function'
  ) {
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    return bytesToHex(bytes);
  }

  // Deterministic-length fallback when WebCrypto random source is unavailable
  const fallback = `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
  return fallback.padEnd(32, '0').slice(0, 32);
}

function rightRotate(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}

/**
 * Pure TypeScript SHA-256 fallback used only when `crypto.subtle` is unavailable
 * (e.g., non-secure HTTP context). Produces the exact same digest as `crypto.subtle.digest('SHA-256')`.
 */
function sha256PureHex(input: string): string {
  const utf8 = new TextEncoder().encode(input);
  const bitLength = utf8.length * 8;
  const paddedLength = Math.ceil((utf8.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(utf8);
  padded[utf8.length] = 0x80;

  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000), false);
  view.setUint32(paddedLength - 4, bitLength >>> 0, false);

  let h0: number = SHA256_INITIAL_H[0];
  let h1: number = SHA256_INITIAL_H[1];
  let h2: number = SHA256_INITIAL_H[2];
  let h3: number = SHA256_INITIAL_H[3];
  let h4: number = SHA256_INITIAL_H[4];
  let h5: number = SHA256_INITIAL_H[5];
  let h6: number = SHA256_INITIAL_H[6];
  let h7: number = SHA256_INITIAL_H[7];

  const w = new Uint32Array(64);

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = view.getUint32(offset + i * 4, false);
    }

    for (let i = 16; i < 64; i++) {
      const w15 = w[i - 15] ?? 0;
      const w2 = w[i - 2] ?? 0;
      const w16 = w[i - 16] ?? 0;
      const w7 = w[i - 7] ?? 0;
      const s0 = rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3);
      const s1 = rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10);
      w[i] = (w16 + s0 + w7 + s1) >>> 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;

    for (let i = 0; i < 64; i++) {
      const s1 = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25);
      const ch = (e & f) ^ (~e & g);
      const kVal = SHA256_K[i] ?? 0;
      const wVal = w[i] ?? 0;
      const temp1 = (h + s1 + ch + kVal + wVal) >>> 0;
      const s0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  return [h0, h1, h2, h3, h4, h5, h6, h7].map((v) => v.toString(16).padStart(8, '0')).join('');
}

async function computeSaltedSha256Hex(salt: string, plainPassword: string): Promise<string> {
  const payload = `${salt}:${plainPassword}`;

  if (
    typeof globalThis.crypto !== 'undefined' &&
    typeof globalThis.crypto.subtle !== 'undefined' &&
    typeof globalThis.crypto.subtle.digest === 'function'
  ) {
    const encoded = new TextEncoder().encode(payload);
    const digestBuffer = await globalThis.crypto.subtle.digest('SHA-256', encoded);
    return bytesToHex(new Uint8Array(digestBuffer));
  }

  return sha256PureHex(payload);
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) {
    return false;
  }

  let diff = 0;
  for (let i = 0; i < left.length; i++) {
    diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Simulated client-side password verifier using WebCrypto SHA-256 with per-user random salt
 * and pure deterministic SHA-256 fallback (ADR-0008 §2.3, SECURITY.md).
 *
 * Does NOT replace server-side Argon2id/bcrypt hashing in production backends.
 */
export class WebCryptoSimulatedPasswordVerifier implements PasswordVerifierPort {
  async hashPassword(plainPassword: string, existingSalt?: string): Promise<PasswordHashResult> {
    const salt = existingSalt ?? generateSaltHex();
    const passwordVerifier = await computeSaltedSha256Hex(salt, plainPassword);

    return Object.freeze({
      passwordVerifier,
      salt,
      algorithm: PASSWORD_VERIFIER_ALGORITHM,
    });
  }

  async verifyPassword(
    plainPassword: string,
    credential: Pick<LocalCredential, 'passwordVerifier' | 'salt' | 'algorithm'>,
  ): Promise<boolean> {
    if (credential.algorithm !== PASSWORD_VERIFIER_ALGORITHM) {
      return false;
    }

    const candidateVerifier = await computeSaltedSha256Hex(credential.salt, plainPassword);
    return constantTimeEqual(candidateVerifier, credential.passwordVerifier);
  }
}
