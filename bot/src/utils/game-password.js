const { randomBytes, scryptSync } = require('crypto');

const KEY_LENGTH = 32;

function generateGamePassword() {
    return randomBytes(18).toString('base64url');
}

function hashGamePassword(password) {
    const salt = randomBytes(16);
    const hash = scryptSync(password, salt, KEY_LENGTH);
    return `scrypt$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

module.exports = { generateGamePassword, hashGamePassword };

