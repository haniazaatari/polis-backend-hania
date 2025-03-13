import { describe, expect, it } from '@jest/globals';
import { generateHashedPassword, verifyPassword } from '../../src/services/auth/passwordService.js';

describe('Password Service', () => {
  it('should generate a hashed password', async () => {
    const password = 'testPassword123!';
    const hashedPassword = await generateHashedPassword(password);

    // Verify the hash is a string and not the original password
    expect(typeof hashedPassword).toBe('string');
    expect(hashedPassword).not.toBe(password);
    expect(hashedPassword.length).toBeGreaterThan(20); // bcrypt hashes are long
  });

  it('should verify a password against a hash', async () => {
    const password = 'testPassword123!';
    const hashedPassword = await generateHashedPassword(password);

    // Verify the password matches the hash
    const result = await verifyPassword(password, hashedPassword);
    expect(result).toBe(true);

    // Verify an incorrect password doesn't match
    const wrongResult = await verifyPassword('wrongPassword', hashedPassword);
    expect(wrongResult).toBe(false);
  });
});
