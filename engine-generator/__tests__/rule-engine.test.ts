import { RuleEngine } from '../src/rule-engine';
import { GameState, OrderOfOperation } from '../src/types';
import path from 'path';

describe('RuleEngine', () => {
  let ruleEngine: RuleEngine;
  const rulesPath = path.join(__dirname, '../rules.json');

  beforeEach(() => {
    ruleEngine = new RuleEngine(rulesPath);
  });

  describe('getRules', () => {
    it('should load rules from JSON file', () => {
      const rules = ruleEngine.getRules();
      expect(rules).toBeDefined();
      expect(rules.orderOfOperations).toBeDefined();
      expect(rules.orderOfOperations.length).toBeGreaterThan(0);
    });

    it('should have correct order of operations', () => {
      const rules = ruleEngine.getRules();
      const phases = rules.orderOfOperations;
      
      expect(phases[0].name).toBe('Arson (Lighting)');
      expect(phases[1].name).toBe('Misc First Moves');
      expect(phases[2].name).toBe('Blocking Roles');
      expect(phases[3].name).toBe('Info Roles');
      expect(phases[4].name).toBe('Killing Roles');
      expect(phases[5].name).toBe('Last but Not Least');
    });
  });

  describe('executePhase', () => {
    it('should execute Arsonist lighting phase', () => {
      const phase: OrderOfOperation = {
        name: 'Arson (Lighting)',
        description: 'Arsonist lighting action precedes all other actions',
        roles: ['Arsonist'],
        action: 'light'
      };

      const gameState: GameState = {
        gameId: 1,
        nightNumber: 1,
        players: [
          {
            id: 1,
            username: 'Player1',
            status: 'alive',
            role: 'Arsonist',
            team: 'Neutral',
            isWolf: false,
            isFramed: false,
            actionNotes: 'light',
            isDoused: false
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
        ],
        roles: [],
        gameMeta: [],
        orderOfOperations: [],
        rules: {} as any
      };

      const result = ruleEngine.executePhase(phase, gameState);
      
      expect(result.deaths).toHaveLength(2); // Arsonist and doused player
      expect(result.deaths.some(d => d.player === 'Player1')).toBe(true);
      expect(result.deaths.some(d => d.player === 'Player2')).toBe(true);
      expect(result.deaths.every(d => d.cause === 'burned to death')).toBe(true);
    });

    it('should execute Seer investigation phase', () => {
      const phase: OrderOfOperation = {
        name: 'Info Roles',
        description: 'Roles that gather information',
        roles: ['Seer'],
        action: 'info'
      };

      const gameState: GameState = {
        gameId: 1,
        nightNumber: 1,
        players: [
          {
            id: 1,
            username: 'Player1',
            status: 'alive',
            role: 'Seer',
            team: 'Town',
            isWolf: false,
            isFramed: false,
            actionNotes: 'Player2'
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
        ],
        roles: [],
        gameMeta: [],
        orderOfOperations: [],
        rules: {} as any
      };

      const result = ruleEngine.executePhase(phase, gameState);
      
      expect(result.results).toHaveLength(1);
      expect(result.results[0].player).toBe('Player1');
      expect(result.results[0].resultMessage).toBe('Alpha Wolf');
    });

    it('should execute Alpha Wolf kill phase', () => {
      const phase: OrderOfOperation = {
        name: 'Killing Roles',
        description: 'Roles that can kill other players',
        roles: ['Alpha Wolf'],
        action: 'kill'
      };

      const gameState: GameState = {
        gameId: 1,
        nightNumber: 1,
        players: [
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
            isFramed: false,
            actionNotes: 'Player1'
          }
        ],
        roles: [],
        gameMeta: [],
        orderOfOperations: [],
        rules: {} as any
      };

      const result = ruleEngine.executePhase(phase, gameState);
      
      expect(result.deaths).toHaveLength(1);
      expect(result.deaths[0].player).toBe('Player1');
      expect(result.deaths[0].cause).toBe('killed by Alpha Wolf');
      expect(result.deaths[0].flavor).toBe('blood and fur');
    });

    it('should execute Doctor healing phase', () => {
      const phase: OrderOfOperation = {
        name: 'Last but Not Least',
        description: 'Healing roles that act last',
        roles: ['Doctor'],
        action: 'heal'
      };

      const gameState: GameState = {
        gameId: 1,
        nightNumber: 1,
        players: [
          {
            id: 1,
            username: 'Player1',
            status: 'dead',
            role: 'Seer',
            team: 'Town',
            isWolf: false,
            isFramed: false,
            killedBy: 'Alpha Wolf'
          },
          {
            id: 2,
            username: 'Player2',
            status: 'alive',
            role: 'Doctor',
            team: 'Town',
            isWolf: false,
            isFramed: false,
            actionNotes: 'Player1'
          }
        ],
        roles: [],
        gameMeta: [],
        orderOfOperations: [],
        rules: {} as any
      };

      const result = ruleEngine.executePhase(phase, gameState);
      
      expect(result.results).toHaveLength(1);
      expect(result.results[0].player).toBe('Player2');
      expect(result.results[0].resultMessage).toContain('healed');
    });

    it('should handle framed player for Seer', () => {
      const phase: OrderOfOperation = {
        name: 'Info Roles',
        description: 'Roles that gather information',
        roles: ['Seer'],
        action: 'info'
      };

      const gameState: GameState = {
        gameId: 1,
        nightNumber: 1,
        players: [
          {
            id: 1,
            username: 'Player1',
            status: 'alive',
            role: 'Seer',
            team: 'Town',
            isWolf: false,
            isFramed: false,
            actionNotes: 'Player2'
          },
          {
            id: 2,
            username: 'Player2',
            status: 'alive',
            role: 'Seer',
            team: 'Town',
            isWolf: false,
            isFramed: true,
            framedNight: 1
          }
        ],
        roles: [
          {
            id: 1,
            name: 'Alpha Wolf',
            team: 'Wolf',
            targets: 'Players',
            moves: true,
            description: 'Wolf role',
            inputRequirements: {
              type: 'player_dropdown',
              description: 'Select a player to kill',
              validation: 'Target must be alive'
            }
          }
        ],
        gameMeta: [],
        orderOfOperations: [],
        rules: {} as any
      };

      const result = ruleEngine.executePhase(phase, gameState);
      
      expect(result.results).toHaveLength(1);
      expect(result.results[0].player).toBe('Player1');
      // Should show a random wolf role instead of the actual role
      expect(result.results[0].resultMessage).toBe('Alpha Wolf');
    });

    it('should handle Bartender with framed target', () => {
      const phase: OrderOfOperation = {
        name: 'Info Roles',
        description: 'Roles that gather information',
        roles: ['Bartender'],
        action: 'info'
      };

      const gameState: GameState = {
        gameId: 1,
        nightNumber: 1,
        players: [
          {
            id: 1,
            username: 'Player1',
            status: 'alive',
            role: 'Bartender',
            team: 'Town',
            isWolf: false,
            isFramed: false,
            actionNotes: 'Player2'
          },
          {
            id: 2,
            username: 'Player2',
            status: 'alive',
            role: 'Seer',
            team: 'Town',
            isWolf: false,
            isFramed: true,
            framedNight: 1
          }
        ],
        roles: [
          {
            id: 1,
            name: 'Seer',
            team: 'Town',
            targets: 'Players',
            moves: false,
            description: 'Town role',
            inputRequirements: {
              type: 'player_dropdown',
              description: 'Select a player to investigate',
              validation: 'Target must be alive'
            }
          },
          {
            id: 2,
            name: 'Alpha Wolf',
            team: 'Wolf',
            targets: 'Players',
            moves: true,
            description: 'Wolf role',
            inputRequirements: {
              type: 'player_dropdown',
              description: 'Select a player to kill',
              validation: 'Target must be alive'
            }
          }
        ],
        gameMeta: [],
        orderOfOperations: [],
        rules: {} as any
      };

      const result = ruleEngine.executePhase(phase, gameState);
      
      expect(result.results).toHaveLength(1);
      expect(result.results[0].player).toBe('Player1');
      // Should show three lies for framed target
      const resultMessage = result.results[0].resultMessage;
      expect(resultMessage).toContain(' / ');
      expect(resultMessage.split(' / ')).toHaveLength(3);
    });
  });
}); 