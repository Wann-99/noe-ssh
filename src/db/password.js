const crypto = require('crypto');
const { promisify } = require('util');

const scryptAsync = promisify(crypto.scrypt);
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEYLEN = 64;

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derived = await scryptAsync(String(password), salt, KEYLEN, SCRYPT_PARAMS);
  return `scrypt$${salt.toString('base64')}$${Buffer.from(derived).toString('base64')}`;
}

async function verifyPassword(password, stored) {
  if (!stored || typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[1], 'base64');
  const expected = Buffer.from(parts[2], 'base64');
  const derived = await scryptAsync(String(password), salt, expected.length, SCRYPT_PARAMS);
  return crypto.timingSafeEqual(expected, Buffer.from(derived));
}

module.exports = { hashPassword, verifyPassword };
