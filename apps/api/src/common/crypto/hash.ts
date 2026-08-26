import { createHash, randomBytes, randomInt, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import { promisify } from 'node:util';

/**
 * `promisify` collapses scrypt's overloads and drops the options argument, so the
 * promisified form is typed explicitly here. Without this the cost parameters
 * (N, r, p) cannot be passed and scrypt would silently run at its weak defaults.
 */
const scryptAsync = promisify(scrypt) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: ScryptOptions,
) => Promise<Buffer>;

/**
 * Password and OTP hashing.
 *
 * scrypt from Node's standard library is used rather than argon2 or bcrypt: it is
 * memory-hard, needs no native compilation (which matters for a clean Docker
 * build and for a client who has to maintain this), and is the algorithm
 * recommended by Node's own crypto guidance.
 */

const SCRYPT_KEYLEN = 64;
const SCRYPT_COST = 16384; // 2^14
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELISM = 1;

export async function hashSecret(plain: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scryptAsync(plain.normalize('NFKC'), salt, SCRYPT_KEYLEN, {
    N: SCRYPT_COST,
    r: SCRYPT_BLOCK_SIZE,
    p: SCRYPT_PARALLELISM,
  });
  return ['scrypt', SCRYPT_COST, SCRYPT_BLOCK_SIZE, SCRYPT_PARALLELISM, salt.toString('base64'), derived.toString('base64')].join(
    '$',
  );
}

export async function verifySecret(plain: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, nStr, rStr, pStr, saltB64, hashB64] = parts;
  const salt = Buffer.from(saltB64, 'base64');
  const expected = Buffer.from(hashB64, 'base64');
  let derived: Buffer;
  try {
    derived = await scryptAsync(plain.normalize('NFKC'), salt, expected.length, {
      N: Number(nStr),
      r: Number(rStr),
      p: Number(pStr),
    });
  } catch {
    return false;
  }
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

/** SHA-256 hex. Used for refresh/session token lookup keys, not for passwords. */
export function sha256Hex(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex');
}

/** URL-safe random token. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/**
 * Numeric OTP code. Uses crypto.randomInt (rejection sampling) rather than
 * Math.random so codes are not predictable from prior codes.
 */
export function generateNumericCode(length: number): string {
  let out = '';
  for (let i = 0; i < length; i += 1) out += randomInt(0, 10).toString();
  return out;
}

/** Constant-time comparison of two strings of arbitrary length. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  // Hash first so differing lengths do not leak through an early return.
  const ha = createHash('sha256').update(bufA).digest();
  const hb = createHash('sha256').update(bufB).digest();
  return timingSafeEqual(ha, hb);
}

/**
 * Short, human-quotable reference such as "RV-8F3K2Q".
 * Excludes I, O, 0, 1 to avoid read-back errors over the phone with support.
 */
const REFERENCE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
export function generateReference(prefix = 'RV', length = 6): string {
  let body = '';
  for (let i = 0; i < length; i += 1) {
    body += REFERENCE_ALPHABET[randomInt(0, REFERENCE_ALPHABET.length)];
  }
  return `${prefix}-${body}`;
}
