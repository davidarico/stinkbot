import { RoleEngine } from '../src/role-engine';
import { NightAction, GameState } from '../src/types';
import path from 'path';

describe('RoleEngine', () => {
  let roleEngine: RoleEngine;
  const rolesPath = path.join(__dirname, '../roles.json');

  beforeEach(() => {
    roleEngine = new RoleEngine(rolesPath);
  });

  describe('getAllRoles', () => {
    it('should return all available roles', () => {
      const roles = roleEngine.getAllRoles();
      expect(roles).toBeDefined();
      expect(roles.length).toBeGreaterThan(0);
      expect(roles.some(role => role.name === 'Seer')).toBe(true);
      expect(roles.some(role => role.name === 'Alpha Wolf')).toBe(true);
      expect(roles.some(role => role.name === 'Arsonist')).toBe(true);
    });
  });

  describe('getRoleById', () => {
    it('should return role by ID', () => {
      const seer = roleEngine.getRoleById(14); // Seer
      expect(seer).toBeDefined();
      expect(seer?.name).toBe('Seer');
      expect(seer?.team).toBe('Town');
      expect(seer?.id).toBe(14);
    });

    it('should return null for invalid role ID', () => {
      const role = roleEngine.getRoleById(999);
      expect(role).toBeNull();
    });
  });

  describe('getRoleByName', () => {
    it('should return role by name', () => {
      const seer = roleEngine.getRoleByName('Seer');
      expect(seer).toBeDefined();
      expect(seer?.name).toBe('Seer');
      expect(seer?.team).toBe('Town');
    });

    it('should return null for invalid role name', () => {
      const role = roleEngine.getRoleByName('InvalidRole');
      expect(role).toBeNull();
    });
  });

  describe('validateAction', () => {
    const createGameState = (players: any[]): GameState => ({
      gameId: 1,
      nightNumber: 1,
      players,
      roles: [],
      gameMeta: [],
      orderOfOperations: [],
      rules: {} as any
    });

    describe('Seer validation', () => {
      it('should validate valid Seer action', () => {
        const action: NightAction = {
          playerId: 1,
          action: 'Player2',
          target: 'Player2',
          actionType: 'investigate'
        };

        const gameState = createGameState([
          {
            id: 1,
            username: 'Player1',
            status: 'alive',
            role: 'Seer',
            team: 'Town',
            isWolf: false,
            isFramed: false
          },
          {
            id: 2,
            username: 'Player2',
            status: 'alive',
            role: 'Alpha Wolf',
            team: 'Wolf',
            isWolf: true,
            isFramed: false
          }
        ]);

        const seer = roleEngine.getRoleByName('Seer');
        const isValid = roleEngine.validateAction(seer!, action, gameState);
        expect(isValid).toBe(true);
      });

      it('should reject Seer action for dead target', () => {
        const action: NightAction = {
          playerId: 1,
          action: 'Player2',
          target: 'Player2',
          actionType: 'investigate'
        };

        const gameState = createGameState([
          {
            id: 1,
            username: 'Player1',
            status: 'alive',
            role: 'Seer',
            team: 'Town',
            isWolf: false,
            isFramed: false
          },
          {
            id: 2,
            username: 'Player2',
            status: 'dead',
            role: 'Alpha Wolf',
            team: 'Wolf',
            isWolf: true,
            isFramed: false
          }
        ]);

        const seer = roleEngine.getRoleByName('Seer');
        const isValid = roleEngine.validateAction(seer!, action, gameState);
        expect(isValid).toBe(false);
      });
    });

    describe('Alpha Wolf validation', () => {
      it('should validate valid Alpha Wolf action', () => {
        const action: NightAction = {
          playerId: 2,
          action: 'Player1',
          target: 'Player1',
          actionType: 'kill'
        };

        const gameState = createGameState([
          {
            id: 1,
            username: 'Player1',
            status: 'alive',
            role: 'Seer',
            team: 'Town',
            isWolf: false,
            isFramed: false
          },
          {
            id: 2,
            username: 'Player2',
            status: 'alive',
            role: 'Alpha Wolf',
            team: 'Wolf',
            isWolf: true,
            isFramed: false
          }
        ]);

        const alphaWolf = roleEngine.getRoleByName('Alpha Wolf');
        const isValid = roleEngine.validateAction(alphaWolf!, action, gameState);
        expect(isValid).toBe(true);
      });

      it('should reject Alpha Wolf action for UTAH target', () => {
        const action: NightAction = {
          playerId: 2,
          action: 'Player1',
          target: 'Player1',
          actionType: 'kill'
        };

        const gameState = createGameState([
          {
            id: 1,
            username: 'Player1',
            status: 'alive',
            role: 'Sleepwalker',
            team: 'Town',
            isWolf: false,
            isFramed: false
          },
          {
            id: 2,
            username: 'Player2',
            status: 'alive',
            role: 'Alpha Wolf',
            team: 'Wolf',
            isWolf: true,
            isFramed: false
          }
        ]);

        const alphaWolf = roleEngine.getRoleByName('Alpha Wolf');
        const isValid = roleEngine.validateAction(alphaWolf!, action, gameState);
        expect(isValid).toBe(false);
      });
    });

    describe('Bartender validation', () => {
      it('should validate valid Bartender action', () => {
        const action: NightAction = {
          playerId: 1,
          action: 'Player2',
          target: 'Player2',
          actionType: 'visit'
        };

        const gameState = createGameState([
          {
            id: 1,
            username: 'Player1',
            status: 'alive',
            role: 'Bartender',
            team: 'Town',
            isWolf: false,
            isFramed: false
          },
          {
            id: 2,
            username: 'Player2',
            status: 'alive',
            role: 'Seer',
            team: 'Town',
            isWolf: false,
            isFramed: false
          }
        ]);

        const bartender = roleEngine.getRoleByName('Bartender');
        const isValid = roleEngine.validateAction(bartender!, action, gameState);
        expect(isValid).toBe(true);
      });

      it('should reject Bartender action for UTAH target', () => {
        const action: NightAction = {
          playerId: 1,
          action: 'Player2',
          target: 'Player2',
          actionType: 'visit'
        };

        const gameState = createGameState([
          {
            id: 1,
            username: 'Player1',
            status: 'alive',
            role: 'Bartender',
            team: 'Town',
            isWolf: false,
            isFramed: false
          },
          {
            id: 2,
            username: 'Player2',
            status: 'alive',
            role: 'Sleepwalker',
            team: 'Town',
            isWolf: false,
            isFramed: false
          }
        ]);

        const bartender = roleEngine.getRoleByName('Bartender');
        const isValid = roleEngine.validateAction(bartender!, action, gameState);
        expect(isValid).toBe(false);
      });
    });

    describe('Hunter validation', () => {
      it('should validate valid Hunter action', () => {
        const action: NightAction = {
          playerId: 1,
          action: 'Player2',
          target: 'Player2',
          actionType: 'kill'
        };

        const gameState = createGameState([
          {
            id: 1,
            username: 'Player1',
            status: 'alive',
            role: 'Hunter',
            team: 'Town',
            isWolf: false,
            isFramed: false,
            chargesLeft: 3
          },
          {
            id: 2,
            username: 'Player2',
            status: 'alive',
            role: 'Alpha Wolf',
            team: 'Wolf',
            isWolf: true,
            isFramed: false
          }
        ]);

        const hunter = roleEngine.getRoleByName('Hunter');
        const isValid = roleEngine.validateAction(hunter!, action, gameState);
        expect(isValid).toBe(true);
      });

      it('should reject Hunter action when out of charges', () => {
        const action: NightAction = {
          playerId: 1,
          action: 'Player2',
          target: 'Player2',
          actionType: 'kill'
        };

        const gameState = createGameState([
          {
            id: 1,
            username: 'Player1',
            status: 'alive',
            role: 'Hunter',
            team: 'Town',
            isWolf: false,
            isFramed: false,
            chargesLeft: 0
          },
          {
            id: 2,
            username: 'Player2',
            status: 'alive',
            role: 'Alpha Wolf',
            team: 'Wolf',
            isWolf: true,
            isFramed: false
          }
        ]);

        const hunter = roleEngine.getRoleByName('Hunter');
        const isValid = roleEngine.validateAction(hunter!, action, gameState);
        expect(isValid).toBe(false);
      });
    });

    describe('Gravedigger validation', () => {
      it('should validate valid Gravedigger action', () => {
        const action: NightAction = {
          playerId: 1,
          action: 'Player2',
          target: 'Player2',
          actionType: 'dig'
        };

        const gameState = createGameState([
          {
            id: 1,
            username: 'Player1',
            status: 'alive',
            role: 'Gravedigger',
            team: 'Town',
            isWolf: false,
            isFramed: false
          },
          {
            id: 2,
            username: 'Player2',
            status: 'dead',
            role: 'Alpha Wolf',
            team: 'Wolf',
            isWolf: true,
            isFramed: false
          }
        ]);

        const gravedigger = roleEngine.getRoleByName('Gravedigger');
        const isValid = roleEngine.validateAction(gravedigger!, action, gameState);
        expect(isValid).toBe(true);
      });

      it('should reject Gravedigger action for alive target', () => {
        const action: NightAction = {
          playerId: 1,
          action: 'Player2',
          target: 'Player2',
          actionType: 'dig'
        };

        const gameState = createGameState([
          {
            id: 1,
            username: 'Player1',
            status: 'alive',
            role: 'Gravedigger',
            team: 'Town',
            isWolf: false,
            isFramed: false
          },
          {
            id: 2,
            username: 'Player2',
            status: 'alive',
            role: 'Alpha Wolf',
            team: 'Wolf',
            isWolf: true,
            isFramed: false
          }
        ]);

        const gravedigger = roleEngine.getRoleByName('Gravedigger');
        const isValid = roleEngine.validateAction(gravedigger!, action, gameState);
        expect(isValid).toBe(false);
      });
    });

    describe('Sleepwalker validation', () => {
      it('should validate valid Sleepwalker action', () => {
        const action: NightAction = {
          playerId: 1,
          action: 'Player2,Player3',
          target: 'Player2',
          secondaryTarget: 'Player3',
          actionType: 'visit'
        };

        const gameState = createGameState([
          {
            id: 1,
            username: 'Player1',
            status: 'alive',
            role: 'Sleepwalker',
            team: 'Town',
            isWolf: false,
            isFramed: false
          },
          {
            id: 2,
            username: 'Player2',
            status: 'alive',
            role: 'Seer',
            team: 'Town',
            isWolf: false,
            isFramed: false
          },
          {
            id: 3,
            username: 'Player3',
            status: 'alive',
            role: 'Alpha Wolf',
            team: 'Wolf',
            isWolf: true,
            isFramed: false
          }
        ]);

        const sleepwalker = roleEngine.getRoleByName('Sleepwalker');
        const isValid = roleEngine.validateAction(sleepwalker!, action, gameState);
        expect(isValid).toBe(true);
      });

      it('should reject Sleepwalker action with missing secondary target', () => {
        const action: NightAction = {
          playerId: 1,
          action: 'Player2',
          target: 'Player2',
          actionType: 'visit'
        };

        const gameState = createGameState([
          {
            id: 1,
            username: 'Player1',
            status: 'alive',
            role: 'Sleepwalker',
            team: 'Town',
            isWolf: false,
            isFramed: false
          },
          {
            id: 2,
            username: 'Player2',
            status: 'alive',
            role: 'Seer',
            team: 'Town',
            isWolf: false,
            isFramed: false
          }
        ]);

        const sleepwalker = roleEngine.getRoleByName('Sleepwalker');
        const isValid = roleEngine.validateAction(sleepwalker!, action, gameState);
        expect(isValid).toBe(false);
      });
    });

    describe('Arsonist validation', () => {
      it('should validate valid Arsonist douse action', () => {
        const action: NightAction = {
          playerId: 1,
          action: 'douse Player2',
          target: 'Player2',
          actionType: 'douse'
        };

        const gameState = createGameState([
          {
            id: 1,
            username: 'Player1',
            status: 'alive',
            role: 'Arsonist',
            team: 'Neutral',
            isWolf: false,
            isFramed: false
          },
          {
            id: 2,
            username: 'Player2',
            status: 'alive',
            role: 'Seer',
            team: 'Town',
            isWolf: false,
            isFramed: false
          }
        ]);

        const arsonist = roleEngine.getRoleByName('Arsonist');
        const isValid = roleEngine.validateAction(arsonist!, action, gameState);
        expect(isValid).toBe(true);
      });

      it('should validate valid Arsonist light action', () => {
        const action: NightAction = {
          playerId: 1,
          action: 'light',
          actionType: 'light'
        };

        const gameState = createGameState([
          {
            id: 1,
            username: 'Player1',
            status: 'alive',
            role: 'Arsonist',
            team: 'Neutral',
            isWolf: false,
            isFramed: false
          },
          {
            id: 2,
            username: 'Player2',
            status: 'alive',
            role: 'Seer',
            team: 'Town',
            isWolf: false,
            isFramed: false,
            isDoused: true
          }
        ]);

        const arsonist = roleEngine.getRoleByName('Arsonist');
        const isValid = roleEngine.validateAction(arsonist!, action, gameState);
        expect(isValid).toBe(true);
      });

      it('should reject Arsonist light action with no doused players', () => {
        const action: NightAction = {
          playerId: 1,
          action: 'light',
          actionType: 'light'
        };

        const gameState = createGameState([
          {
            id: 1,
            username: 'Player1',
            status: 'alive',
            role: 'Arsonist',
            team: 'Neutral',
            isWolf: false,
            isFramed: false
          },
          {
            id: 2,
            username: 'Player2',
            status: 'alive',
            role: 'Seer',
            team: 'Town',
            isWolf: false,
            isFramed: false,
            isDoused: false
          }
        ]);

        const arsonist = roleEngine.getRoleByName('Arsonist');
        const isValid = roleEngine.validateAction(arsonist!, action, gameState);
        expect(isValid).toBe(false);
      });
    });
  });
}); 