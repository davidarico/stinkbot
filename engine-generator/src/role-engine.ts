import { Role, NightAction, GameState } from './types';
import * as fs from 'fs';

export class RoleEngine {
  private roles: Role[];

  constructor(rolesPath: string) {
    this.roles = this.loadRoles(rolesPath);
  }

  getAllRoles(): Role[] {
    return this.roles;
  }

  getRoleById(id: number): Role | null {
    return this.roles.find(role => role.id === id) || null;
  }

  getRoleByName(name: string): Role | null {
    return this.roles.find(role => role.name === name) || null;
  }

  validateAction(role: Role, action: NightAction, gameState: GameState): boolean {
    // Basic validation
    if (!action.action) {
      return false;
    }

    // Role-specific validation
    switch (role.name) {
      case 'Bartender':
        return this.validateBartenderAction(action, gameState);
      case 'Doctor':
        return this.validateDoctorAction(action, gameState);
      case 'Escort':
        return this.validateEscortAction(action, gameState);
      case 'Gravedigger':
        return this.validateGravediggerAction(action, gameState);
      case 'Hunter':
        return this.validateHunterAction(action, gameState);
      case 'Jailkeeper':
        return this.validateJailkeeperAction(action, gameState);
      case 'Locksmith':
        return this.validateLocksmithAction(action, gameState);
      case 'Lookout':
        return this.validateLookoutAction(action, gameState);
      case 'Matchmaker':
        return this.validateMatchmakerAction(action, gameState);
      case 'Patrolman':
        return this.validatePatrolmanAction(action, gameState);
      case 'Seer':
        return this.validateSeerAction(action, gameState);
      case 'Sleepwalker':
        return this.validateSleepwalkerAction(action, gameState);
      case 'Veteran':
        return this.validateVeteranAction(action, gameState);
      case 'Alpha Wolf':
        return this.validateAlphaWolfAction(action, gameState);
      case 'Bloodhound':
        return this.validateBloodhoundAction(action, gameState);
      case 'Clairvoyant':
        return this.validateClairvoyantAction(action, gameState);
      case 'Consort':
        return this.validateConsortAction(action, gameState);
      case 'Framer':
        return this.validateFramerAction(action, gameState);
      case 'Glutton':
        return this.validateGluttonAction(action, gameState);
      case 'Hypnotist':
        return this.validateHypnotistAction(action, gameState);
      case 'Lone Wolf':
        return this.validateLoneWolfAction(action, gameState);
      case 'Stalker':
        return this.validateStalkerAction(action, gameState);
      case 'Arsonist':
        return this.validateArsonistAction(action, gameState);
      case 'Graverobber':
        return this.validateGraverobberAction(action, gameState);
      case 'Murderer':
        return this.validateMurdererAction(action, gameState);
      case 'Orphan':
        return this.validateOrphanAction(action, gameState);
      case 'Plague Bringer':
        return this.validatePlagueBringerAction(action, gameState);
      case 'Serial Killer':
        return this.validateSerialKillerAction(action, gameState);
      default:
        return true; // Default to valid for roles without specific validation
    }
  }

  private validateBartenderAction(action: NightAction, gameState: GameState): boolean {
    const target = gameState.players.find(p => p.username === action.target);
    if (!target || target.status !== 'alive') return false;

    // Check if target is untargetable at home (UTAH)
    if (['Sleepwalker', 'Orphan', 'Lone Wolf'].includes(target.role)) {
      return false;
    }

    return true;
  }

  private validateDoctorAction(action: NightAction, gameState: GameState): boolean {
    const target = gameState.players.find(p => p.username === action.target);
    return !!(target && target.status === 'alive');
  }

  private validateEscortAction(action: NightAction, gameState: GameState): boolean {
    const target = gameState.players.find(p => p.username === action.target);
    if (!target || target.status !== 'alive') return false;

    // Check if target is untargetable at home (UTAH)
    if (['Sleepwalker', 'Orphan', 'Lone Wolf'].includes(target.role)) {
      return false;
    }

    return true;
  }

  private validateGravediggerAction(action: NightAction, gameState: GameState): boolean {
    const target = gameState.players.find(p => p.username === action.target);
    return !!(target && target.status === 'dead');
  }

  private validateHunterAction(action: NightAction, gameState: GameState): boolean {
    const target = gameState.players.find(p => p.username === action.target);
    if (!target || target.status !== 'alive') return false;

    // Check if target is untargetable at home (UTAH)
    if (['Sleepwalker', 'Orphan', 'Lone Wolf'].includes(target.role)) {
      return false;
    }

    // Check if Hunter has charges
    const hunter = gameState.players.find(p => p.id === action.playerId);
    if (hunter && (hunter.chargesLeft ?? 0) <= 0) return false;

    return true;
  }

  private validateJailkeeperAction(action: NightAction, gameState: GameState): boolean {
    const target = gameState.players.find(p => p.username === action.target);
    if (!target || target.status !== 'alive') return false;

    // Check if target is untargetable at home (UTAH)
    if (['Sleepwalker', 'Orphan', 'Lone Wolf'].includes(target.role)) {
      return false;
    }

    return true;
  }

  private validateLocksmithAction(action: NightAction, gameState: GameState): boolean {
    const target = gameState.players.find(p => p.username === action.target);
    if (!target || target.status !== 'alive') return false;

    // Check if it's a lock night (every other night)
    const locksmith = gameState.players.find(p => p.id === action.playerId);
    if (locksmith) {
      // This is a simplified check - in practice, you'd need to track lock nights
      return true;
    }

    return true;
  }

  private validateLookoutAction(action: NightAction, gameState: GameState): boolean {
    const target = gameState.players.find(p => p.username === action.target);
    return !!(target && target.status === 'alive');
  }

  private validateMatchmakerAction(action: NightAction, gameState: GameState): boolean {
    if (!action.target || !action.secondaryTarget) return false;

    const target1 = gameState.players.find(p => p.username === action.target);
    const target2 = gameState.players.find(p => p.username === action.secondaryTarget);
    
    if (!target1 || !target2 || target1.status !== 'alive' || target2.status !== 'alive') {
      return false;
    }

    // Check if first target is untargetable at home (UTAH)
    if (['Sleepwalker', 'Orphan', 'Lone Wolf'].includes(target1.role)) {
      return false;
    }

    return true;
  }

  private validatePatrolmanAction(action: NightAction, gameState: GameState): boolean {
    const target = gameState.players.find(p => p.username === action.target);
    return !!(target && target.status === 'alive');
  }

  private validateSeerAction(action: NightAction, gameState: GameState): boolean {
    const target = gameState.players.find(p => p.username === action.target);
    return !!(target && target.status === 'alive');
  }

  private validateSleepwalkerAction(action: NightAction, gameState: GameState): boolean {
    if (!action.target || !action.secondaryTarget) return false;

    const target1 = gameState.players.find(p => p.username === action.target);
    const target2 = gameState.players.find(p => p.username === action.secondaryTarget);
    
    return !!(target1 && target2 && target1.status === 'alive' && target2.status === 'alive');
  }

  private validateVeteranAction(action: NightAction, gameState: GameState): boolean {
    // Veteran just needs to toggle alert
    const veteran = gameState.players.find(p => p.id === action.playerId);
    if (!veteran || (veteran.chargesLeft ?? 0) <= 0) return false;

    return action.action.includes('alert');
  }

  private validateAlphaWolfAction(action: NightAction, gameState: GameState): boolean {
    const target = gameState.players.find(p => p.username === action.target);
    if (!target || target.status !== 'alive') return false;

    // Check if target is untargetable at home (UTAH)
    if (['Sleepwalker', 'Orphan', 'Lone Wolf'].includes(target.role)) {
      return false;
    }

    return true;
  }

  private validateBloodhoundAction(action: NightAction, gameState: GameState): boolean {
    const targetRole = action.target;
    if (!targetRole || targetRole === 'Villager') return false;

    // Check if role exists in game
    const roleExists = gameState.roles.some(r => r.name === targetRole);
    return roleExists;
  }

  private validateClairvoyantAction(action: NightAction, gameState: GameState): boolean {
    const target = gameState.players.find(p => p.username === action.target);
    if (!target || target.status !== 'alive') return false;

    // Check if target is untargetable at home (UTAH)
    if (['Sleepwalker', 'Orphan', 'Lone Wolf'].includes(target.role)) {
      return false;
    }

    return true;
  }

  private validateConsortAction(action: NightAction, gameState: GameState): boolean {
    const target = gameState.players.find(p => p.username === action.target);
    if (!target || target.status !== 'alive') return false;

    // Check if target is untargetable at home (UTAH)
    if (['Sleepwalker', 'Orphan', 'Lone Wolf'].includes(target.role)) {
      return false;
    }

    return true;
  }

  private validateFramerAction(action: NightAction, gameState: GameState): boolean {
    const target = gameState.players.find(p => p.username === action.target);
    return !!(target && target.status === 'alive');
  }

  private validateGluttonAction(action: NightAction, gameState: GameState): boolean {
    const target = gameState.players.find(p => p.username === action.target);
    if (!target || target.status !== 'alive') return false;

    // Check if target is untargetable at home (UTAH)
    if (['Sleepwalker', 'Orphan', 'Lone Wolf'].includes(target.role)) {
      return false;
    }

    // Check if Glutton has charges
    const glutton = gameState.players.find(p => p.id === action.playerId);
    if (glutton && (glutton.chargesLeft ?? 0) <= 0) return false;

    return true;
  }

  private validateHypnotistAction(action: NightAction, gameState: GameState): boolean {
    const target = gameState.players.find(p => p.username === action.target);
    if (!target || target.status !== 'alive') return false;

    // Check if target is untargetable at home (UTAH)
    if (['Sleepwalker', 'Orphan', 'Lone Wolf'].includes(target.role)) {
      return false;
    }

    return true;
  }

  private validateLoneWolfAction(action: NightAction, gameState: GameState): boolean {
    const target = gameState.players.find(p => p.username === action.target);
    return !!(target && target.status === 'alive');
  }

  private validateStalkerAction(action: NightAction, gameState: GameState): boolean {
    const target = gameState.players.find(p => p.username === action.target);
    if (!target || target.status !== 'alive') return false;

    // Check if Stalker has charges
    const stalker = gameState.players.find(p => p.id === action.playerId);
    if (stalker && (stalker.chargesLeft ?? 0) <= 0) return false;

    return true;
  }

  private validateArsonistAction(action: NightAction, gameState: GameState): boolean {
    if (action.action.includes('light')) {
      // Check if there are doused players
      const dousedPlayers = gameState.players.filter(p => p.isDoused);
      return dousedPlayers.length > 0;
    } else if (action.action.includes('douse')) {
      const target = gameState.players.find(p => p.username === action.target);
      if (!target || target.status !== 'alive') return false;

      // Check if target is untargetable at home (UTAH)
      if (['Sleepwalker', 'Orphan', 'Lone Wolf'].includes(target.role)) {
        return false;
      }

      return true;
    }

    return false;
  }

  private validateGraverobberAction(action: NightAction, gameState: GameState): boolean {
    const target = gameState.players.find(p => p.username === action.target);
    return !!(target && target.status === 'dead');
  }

  private validateMurdererAction(action: NightAction, gameState: GameState): boolean {
    const target = gameState.players.find(p => p.username === action.target);
    if (!target || target.status !== 'alive') return false;

    // Check if target is untargetable at home (UTAH)
    if (['Sleepwalker', 'Orphan', 'Lone Wolf'].includes(target.role)) {
      return false;
    }

    return true;
  }

  private validateOrphanAction(action: NightAction, gameState: GameState): boolean {
    const target = gameState.players.find(p => p.username === action.target);
    return !!(target && target.status === 'alive');
  }

  private validatePlagueBringerAction(action: NightAction, gameState: GameState): boolean {
    const target = gameState.players.find(p => p.username === action.target);
    return !!(target && target.status === 'alive');
  }

  private validateSerialKillerAction(action: NightAction, gameState: GameState): boolean {
    const target = gameState.players.find(p => p.username === action.target);
    if (!target || target.status !== 'alive') return false;

    // Check if target is untargetable at home (UTAH)
    if (['Sleepwalker', 'Orphan', 'Lone Wolf'].includes(target.role)) {
      return false;
    }

    return true;
  }

  private loadRoles(rolesPath: string): Role[] {
    const rolesData = fs.readFileSync(rolesPath, 'utf8');
    const parsed = JSON.parse(rolesData);
    return parsed.roles;
  }
} 