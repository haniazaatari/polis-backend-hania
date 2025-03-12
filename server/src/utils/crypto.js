import crypto from 'crypto';

/**
 * Generate random bytes and convert to base64 string
 * @param {number} bytes - Number of bytes to generate
 * @param {boolean} [pseudoRandomOk=false] - Whether pseudorandom is acceptable
 * @returns {string} Random string in base64 format
 */
export function generateRandomString(bytes, pseudoRandomOk = false) {
  const generator = pseudoRandomOk ? crypto.pseudoRandomBytes : crypto.randomBytes;
  return generator(bytes)
    .toString('base64')
    .replace(/[^A-Za-z0-9]/g, '');
}

/**
 * Generate a token of specified length
 * @param {number} length - Desired length of token
 * @param {boolean} [pseudoRandomOk=false] - Whether pseudorandom is acceptable
 * @returns {string} Token string
 */
export function generateToken(length, pseudoRandomOk = false) {
  // Generate more bytes than needed to ensure we have enough characters after base64 conversion
  const bytes = Math.ceil((length * 4) / 3);
  return generateRandomString(bytes, pseudoRandomOk).substr(0, length);
}
