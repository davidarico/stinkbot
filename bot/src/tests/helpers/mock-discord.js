'use strict';

function createMockMessage(overrides = {}) {
    return {
        content: '',
        author: {
            id: 'user-123',
            displayName: 'TestUser',
            bot: false,
            tag: 'TestUser#0001',
        },
        member: {
            id: 'user-123',
            displayName: 'TestUser',
            roles: {
                cache: { has: jest.fn().mockReturnValue(false) },
                add: jest.fn().mockResolvedValue(undefined),
                remove: jest.fn().mockResolvedValue(undefined),
            },
            permissions: {
                has: jest.fn().mockReturnValue(false),
            },
        },
        guild: {
            id: 'guild-123',
            name: 'Test Guild',
            roles: {
                everyone: { id: 'everyone-role-id' },
                cache: {
                    find: jest.fn().mockReturnValue(null),
                },
            },
            channels: {
                cache: { size: 10, filter: jest.fn().mockReturnValue({ size: 0 }), get: jest.fn() },
                create: jest.fn().mockResolvedValue(createMockChannel()),
                fetch: jest.fn().mockResolvedValue(new Map()),
            },
            members: {
                cache: new Map(),
                fetch: jest.fn().mockResolvedValue(new Map()),
            },
        },
        channel: {
            id: 'channel-123',
            name: 'test-channel',
            send: jest.fn().mockResolvedValue({ id: 'msg-from-channel', reply: jest.fn(), pin: jest.fn().mockResolvedValue(undefined) }),
            awaitMessages: jest.fn().mockResolvedValue({ size: 0, first: jest.fn() }),
        },
        mentions: {
            members: { first: jest.fn().mockReturnValue(null) },
            users: { first: jest.fn().mockReturnValue(null) },
        },
        reply: jest.fn().mockResolvedValue({ edit: jest.fn().mockResolvedValue({}) }),
        ...overrides,
    };
}

function createMockChannel(overrides = {}) {
    return {
        id: 'channel-' + Math.random().toString(36).slice(2),
        name: 'mock-channel',
        type: 0,
        position: 0,
        parentId: null,
        permissionOverwrites: {
            create: jest.fn().mockResolvedValue(undefined),
            edit: jest.fn().mockResolvedValue(undefined),
        },
        setPosition: jest.fn().mockResolvedValue(undefined),
        send: jest.fn().mockResolvedValue({ id: 'msg-123', pin: jest.fn().mockResolvedValue(undefined) }),
        delete: jest.fn().mockResolvedValue(undefined),
        ...overrides,
    };
}

function createMockMember(overrides = {}) {
    return {
        id: 'member-' + Math.random().toString(36).slice(2),
        displayName: 'MockMember',
        user: { id: 'user-' + Math.random().toString(36).slice(2), tag: 'MockMember#0001' },
        roles: {
            cache: { has: jest.fn().mockReturnValue(false) },
            add: jest.fn().mockResolvedValue(undefined),
            remove: jest.fn().mockResolvedValue(undefined),
        },
        permissions: {
            has: jest.fn().mockReturnValue(false),
        },
        guild: {
            id: 'guild-123',
            roles: { cache: { find: jest.fn().mockReturnValue(null) } },
        },
        ...overrides,
    };
}

function createMockGuild(overrides = {}) {
    return {
        id: 'guild-123',
        name: 'Test Guild',
        roles: {
            everyone: { id: 'everyone-role-id' },
            cache: {
                find: jest.fn().mockReturnValue(null),
                has: jest.fn().mockReturnValue(false),
            },
        },
        channels: {
            cache: {
                size: 10,
                filter: jest.fn().mockReturnValue({ size: 0, values: jest.fn().mockReturnValue([]), first: jest.fn() }),
                get: jest.fn().mockReturnValue(null),
                find: jest.fn().mockReturnValue(null),
            },
            create: jest.fn().mockResolvedValue(createMockChannel()),
            fetch: jest.fn().mockResolvedValue(new Map()),
        },
        members: {
            cache: new Map(),
            fetch: jest.fn().mockResolvedValue(new Map()),
        },
        ...overrides,
    };
}

module.exports = { createMockMessage, createMockChannel, createMockMember, createMockGuild };
