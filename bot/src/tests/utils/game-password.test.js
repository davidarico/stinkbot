const { scryptSync } = require('crypto');
const { generateGamePassword, hashGamePassword } = require('../../utils/game-password');

describe('game dashboard passwords', () => {
    it('generates independent 144-bit base64url credentials', () => {
        const first = generateGamePassword();
        const second = generateGamePassword();

        expect(first).toMatch(/^[A-Za-z0-9_-]{24}$/);
        expect(second).not.toBe(first);
    });

    it('stores a verifiable salted scrypt hash', () => {
        const password = generateGamePassword();
        const encoded = hashGamePassword(password);
        const [algorithm, salt, expectedHash] = encoded.split('$');
        const actualHash = scryptSync(
            password,
            Buffer.from(salt, 'base64url'),
            Buffer.from(expectedHash, 'base64url').length
        ).toString('base64url');

        expect(algorithm).toBe('scrypt');
        expect(actualHash).toBe(expectedHash);
        expect(encoded).not.toContain(password);
    });
});
