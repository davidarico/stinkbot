'use strict';

function createMockDb(defaultRows = []) {
    return {
        query: jest.fn().mockResolvedValue({ rows: defaultRows, rowCount: defaultRows.length }),
    };
}

module.exports = { createMockDb };
