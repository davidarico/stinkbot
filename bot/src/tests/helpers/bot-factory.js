'use strict';

const WerewolfBot = require('../../werewolf-bot');
const { createMockDb } = require('./mock-db');

function createTestBot(clientOverrides = {}, dbOverrides = {}) {
    const mockClient = {
        user: { tag: 'TestBot#0001', id: 'bot-id' },
        guilds: { cache: new Map() },
        ...clientOverrides,
    };
    const mockDb = { ...createMockDb(), ...dbOverrides };
    return new WerewolfBot(mockClient, mockDb);
}

module.exports = { createTestBot };
