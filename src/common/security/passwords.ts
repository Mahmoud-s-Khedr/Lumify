import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const keyLength = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const derivedKey = (await scrypt(password, salt, keyLength)) as Buffer;
  return `${salt}:${derivedKey.toString('hex')}`;
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const [salt, storedKey] = storedHash.split(':');
  if (!salt || !storedKey) return false;

  const derivedKey = (await scrypt(password, salt, keyLength)) as Buffer;
  const expected = Buffer.from(storedKey, 'hex');
  return expected.length === derivedKey.length && timingSafeEqual(expected, derivedKey);
}
