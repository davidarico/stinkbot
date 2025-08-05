import { GameState, NightActionResult, Player, Role, NightAction, RoleInputRequirement } from './types';
import { RuleEngine } from './rule-engine';
import { RoleEngine } from './role-engine';
import { DatabaseAdapter } from './database-adapter';

export class GameEngine {
  private ruleEngine: RuleEngine;
  private roleEngine: RoleEngine;
  private databaseAdapter: DatabaseAdapter;

  constructor(config: { rulesPath: string; rolesPath: string; databasePath?: string }) {
    this.ruleEngine = new RuleEngine(config.rulesPath);
    this.roleEngine = new RoleEngine(config.rolesPath);
    this.databaseAdapter = new DatabaseAdapter(config.databasePath);
  }

  /**
   * Get input requirements for a specific role
   */
  getRoleInputRequirements(roleId: number): RoleInputRequirement | null {
    const role = this.roleEngine.getRoleById(roleId);
    if (!role) return null;

    return {
      roleId: role.id,
      roleName: role.name,
      inputType: role.inputRequirements.type,
      description: role.inputRequirements.description,
      validation: role.inputRequirements.validation,
      options: this.getOptionsForRole(role),
      multiSelect: role.inputRequirements.type === 'two_player_dropdown',
      allowNone: role.inputRequirements.type === 'none'
    };
  }

  /**
   * Calculate night actions for a game
   */
  async calculateNightActions(
    gameId: number,
    nightNumber: number,
    actions: NightAction[]
  ): Promise<NightActionResult> {
    // Load game state
    const gameState = await this.loadGameState(gameId, nightNumber);
    
    // Apply actions to game state
    this.applyActionsToGameState(gameState, actions);
    
    // Execute night actions in order
    const result = this.executeNightActions(gameState);
    
    // Save updated game state
    await this.saveGameState(gameState);
    
    return result;
  }

  /**
   * Get all roles available in the game
   */
  getAllRoles(): Role[] {
    return this.roleEngine.getAllRoles();
  }

  /**
   * Get role by name
   */
  getRoleByName(name: string): Role | null {
    return this.roleEngine.getRoleByName(name);
  }

  /**
   * Get role by ID
   */
  getRoleById(id: number): Role | null {
    return this.roleEngine.getRoleById(id);
  }

  /**
   * Validate if an action is valid for a role
   */
  validateAction(roleId: number, action: NightAction, gameState: GameState): boolean {
    const role = this.roleEngine.getRoleById(roleId);
    if (!role) return false;

    return this.roleEngine.validateAction(role, action, gameState);
  }

  private getOptionsForRole(role: Role): string[] {
    switch (role.inputRequirements.type) {
      case 'player_dropdown':
        return ['alive_players'];
      case 'two_player_dropdown':
        return ['alive_players'];
      case 'dead_player_dropdown':
        return ['dead_players'];
      case 'role_dropdown':
        return ['game_roles'];
      case 'alert_toggle':
        return ['on', 'off'];
      case 'arsonist_action':
        return ['douse', 'light'];
      default:
        return [];
    }
  }

  private async loadGameState(gameId: number, nightNumber: number): Promise<GameState> {
    const players = await this.databaseAdapter.getPlayers(gameId);
    const roles = await this.databaseAdapter.getGameRoles(gameId);
    const gameMeta = await this.databaseAdapter.getGameMeta(gameId, nightNumber);
    const rules = this.ruleEngine.getRules();

    return {
      gameId,
      nightNumber,
      players,
      roles,
      gameMeta,
      orderOfOperations: rules.orderOfOperations,
      rules
    };
  }

  private applyActionsToGameState(gameState: GameState, actions: NightAction[]): void {
    for (const action of actions) {
      const player = gameState.players.find(p => p.id === action.playerId);
      if (player) {
        player.actionNotes = action.action;
        // Additional action processing can be added here
      }
    }
  }

  private executeNightActions(gameState: GameState): NightActionResult {
    const deaths: any[] = [];
    const results: any[] = [];
    let explanation = '';

    // Execute actions in order of operations
    for (const phase of gameState.orderOfOperations) {
      const phaseResult = this.ruleEngine.executePhase(phase, gameState);
      deaths.push(...phaseResult.deaths);
      results.push(...phaseResult.results);
      explanation += phaseResult.explanation + '\n';
    }

    return {
      deaths,
      results,
      explanation: explanation.trim()
    };
  }

  private async saveGameState(gameState: GameState): Promise<void> {
    await this.databaseAdapter.updatePlayers(gameState.gameId, gameState.players);
    await this.databaseAdapter.updateGameMeta(gameState.gameId, gameState.gameMeta);
  }
} 