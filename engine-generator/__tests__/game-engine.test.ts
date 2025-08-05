import { GameEngine } from '../src/game-engine';
import { NightAction, NightActionResult, GameState } from '../src/types';
import path from 'path';

describe('GameEngine', () => {
  let gameEngine: GameEngine;
  const rulesPath = path.join(__dirname, '../rules.json');
  const rolesPath = path.join(__dirname, '../roles.json');

  beforeEach(() => {
    gameEngine = new GameEngine({
      rulesPath,
      rolesPath
    });
  });

  describe('getRoleInputRequirements', () => {
    it('should return input requirements for Bartender role', () => {
      const requirements = gameEngine.getRoleInputRequirements(1); // Bartender
      expect(requirements).toBeDefined();
      expect(requirements?.roleName).toBe('Bartender');
      expect(requirements?.inputType).toBe('player_dropdown');
      expect(requirements?.description).toContain('Select a player to visit');
    });

    it('should return input requirements for Seer role', () => {
      const requirements = gameEngine.getRoleInputRequirements(14); // Seer
      expect(requirements).toBeDefined();
      expect(requirements?.roleName).toBe('Seer');
      expect(requirements?.inputType).toBe('player_dropdown');
      expect(requirements?.description).toContain('Select a player to investigate');
    });

    it('should return input requirements for Sleepwalker role', () => {
      const requirements = gameEngine.getRoleInputRequirements(15); // Sleepwalker
      expect(requirements).toBeDefined();
      expect(requirements?.roleName).toBe('Sleepwalker');
      expect(requirements?.inputType).toBe('two_player_dropdown');
      expect(requirements?.multiSelect).toBe(true);
    });

    it('should return null for invalid role ID', () => {
      const requirements = gameEngine.getRoleInputRequirements(999);
      expect(requirements).toBeNull();
    });
  });

  describe('getAllRoles', () => {
    it('should return all available roles', () => {
      const roles = gameEngine.getAllRoles();
      expect(roles).toBeDefined();
      expect(roles.length).toBeGreaterThan(0);
      expect(roles.some(role => role.name === 'Seer')).toBe(true);
      expect(roles.some(role => role.name === 'Alpha Wolf')).toBe(true);
    });
  });

  describe('getRoleByName', () => {
    it('should return role by name', () => {
      const seer = gameEngine.getRoleByName('Seer');
      expect(seer).toBeDefined();
      expect(seer?.name).toBe('Seer');
      expect(seer?.team).toBe('Town');
    });

    it('should return null for invalid role name', () => {
      const role = gameEngine.getRoleByName('InvalidRole');
      expect(role).toBeNull();
    });
  });

  describe('getRoleById', () => {
    it('should return role by ID', () => {
      const seer = gameEngine.getRoleById(14); // Seer
      expect(seer).toBeDefined();
      expect(seer?.name).toBe('Seer');
      expect(seer?.id).toBe(14);
    });

    it('should return null for invalid role ID', () => {
      const role = gameEngine.getRoleById(999);
      expect(role).toBeNull();
    });
  });

  describe('calculateNightActions', () => {
    it('should calculate basic night actions', async () => {
      const actions: NightAction[] = [
        {
          playerId: 1,
          action: 'Player2',
          target: 'Player2',
          actionType: 'investigate'
        },
        {
          playerId: 2,
          action: 'Player1',
          target: 'Player1',
          actionType: 'kill'
        }
      ];

      const result = await gameEngine.calculateNightActions(1, 1, actions);
      
      expect(result).toBeDefined();
      expect(result.deaths).toBeDefined();
      expect(result.results).toBeDefined();
      expect(result.explanation).toBeDefined();
    });

    it('should handle Seer investigation', async () => {
      const actions: NightAction[] = [
        {
          playerId: 1,
          action: 'Player2',
          target: 'Player2',
          actionType: 'investigate'
        }
      ];

      const result = await gameEngine.calculateNightActions(1, 1, actions);
      
      expect(result.results).toHaveLength(1);
      expect(result.results[0].player).toBe('Player1');
      expect(result.results[0].resultMessage).toBe('Alpha Wolf');
    });

    it('should handle Alpha Wolf kill', async () => {
      const actions: NightAction[] = [
        {
          playerId: 2,
          action: 'Player1',
          target: 'Player1',
          actionType: 'kill'
        }
      ];

      const result = await gameEngine.calculateNightActions(1, 1, actions);
      
      expect(result.deaths).toHaveLength(1);
      expect(result.deaths[0].player).toBe('Player1');
      expect(result.deaths[0].cause).toBe('killed by Alpha Wolf');
      expect(result.deaths[0].flavor).toBe('blood and fur');
    });

    it('should handle Doctor healing', async () => {
      // First, have Alpha Wolf kill Player1
      const killActions: NightAction[] = [
        {
          playerId: 2,
          action: 'Player1',
          target: 'Player1',
          actionType: 'kill'
        }
      ];

      // Then have Doctor heal Player1
      const healActions: NightAction[] = [
        {
          playerId: 3, // Doctor
          action: 'Player1',
          target: 'Player1',
          actionType: 'heal'
        }
      ];

      // Combine actions
      const allActions = [...killActions, ...healActions];
      const result = await gameEngine.calculateNightActions(1, 1, allActions);
      
      // Player1 should survive due to Doctor healing
      expect(result.deaths).toHaveLength(0);
      expect(result.results.some(r => r.player === 'Player3' && r.resultMessage.includes('healed'))).toBe(true);
    });
  });

  describe('validateAction', () => {
    it('should validate valid Seer action', () => {
      const action: NightAction = {
        playerId: 1,
        action: 'Player2',
        target: 'Player2',
        actionType: 'investigate'
      };

      const gameState: GameState = {
        gameId: 1,
        nightNumber: 1,
        players: [
          {
            id: 1,
            username: 'Player1',
            status: 'alive' as const,
            role: 'Seer',
            team: 'Town',
            isWolf: false,
            isFramed: false
          },
          {
            id: 2,
            username: 'Player2',
            status: 'alive' as const,
            role: 'Alpha Wolf',
            team: 'Wolf',
            isWolf: true,
            isFramed: false
          }
        ],
        roles: [],
        gameMeta: [],
        orderOfOperations: [],
        rules: {} as any
      };

      const isValid = gameEngine.validateAction(14, action, gameState); // Seer role ID
      expect(isValid).toBe(true);
    });

    it('should reject invalid action for dead target', () => {
      const action: NightAction = {
        playerId: 1,
        action: 'Player2',
        target: 'Player2',
        actionType: 'investigate'
      };

      const gameState: GameState = {
        gameId: 1,
        nightNumber: 1,
        players: [
          {
            id: 1,
            username: 'Player1',
            status: 'alive' as const,
            role: 'Seer',
            team: 'Town',
            isWolf: false,
            isFramed: false
          },
          {
            id: 2,
            username: 'Player2',
            status: 'dead' as const,
            role: 'Alpha Wolf',
            team: 'Wolf',
            isWolf: true,
            isFramed: false
          }
        ],
        roles: [],
        gameMeta: [],
        orderOfOperations: [],
        rules: {} as any
      };

      const isValid = gameEngine.validateAction(14, action, gameState); // Seer role ID
      expect(isValid).toBe(false);
    });
  });
}); 