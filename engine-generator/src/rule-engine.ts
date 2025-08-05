import { GameState, GameRules, OrderOfOperation, Death, PlayerResult } from './types';
import * as fs from 'fs';

export class RuleEngine {
  private rules: GameRules;

  constructor(rulesPath: string) {
    this.rules = this.loadRules(rulesPath);
  }

  getRules(): GameRules {
    return this.rules;
  }

  executePhase(phase: OrderOfOperation, gameState: GameState): { deaths: Death[]; results: PlayerResult[]; explanation: string } {
    const deaths: Death[] = [];
    const results: PlayerResult[] = [];
    let explanation = '';

    // Get all players with roles in this phase
    const phasePlayers = gameState.players.filter(player => {
      const role = gameState.roles.find(r => r.name === player.role);
      return role && phase.roles.includes(role.name);
    });

    // Execute actions based on phase type
    switch (phase.action) {
      case 'light':
        explanation += this.executeArsonistLighting(gameState, phasePlayers, deaths, results);
        break;
      case 'info_and_movement':
        explanation += this.executeInfoAndMovement(gameState, phasePlayers, deaths, results);
        break;
      case 'block':
        explanation += this.executeBlocking(gameState, phasePlayers, deaths, results);
        break;
      case 'info':
        explanation += this.executeInfoGathering(gameState, phasePlayers, deaths, results);
        break;
      case 'kill':
        explanation += this.executeKilling(gameState, phasePlayers, deaths, results);
        break;
      case 'heal':
        explanation += this.executeHealing(gameState, phasePlayers, deaths, results);
        break;
    }

    return { deaths, results, explanation };
  }

  private executeArsonistLighting(gameState: GameState, players: any[], deaths: Death[], results: PlayerResult[]): string {
    let explanation = '';

    for (const player of players) {
      if (player.role === 'Arsonist' && player.actionNotes?.includes('light')) {
        // Find all doused players
        const dousedPlayers = gameState.players.filter(p => p.isDoused);
        
        if (dousedPlayers.length > 0) {
          // Kill all doused players and the arsonist
          const allVictims = [...dousedPlayers, player];
          
          for (const victim of allVictims) {
            deaths.push({
              player: victim.username,
              cause: 'burned to death',
              killer: 'Arsonist',
              location: 'burned',
              flavor: 'burned'
            });
            
            victim.status = 'dead';
            victim.killedBy = 'Arsonist';
            victim.killFlavor = 'burned';
          }

          explanation += `Arsonist lights all doused players on fire. ${allVictims.map(v => v.username).join(', ')} are burned to death.\n`;
        }
      }
    }

    return explanation;
  }

  private executeInfoAndMovement(gameState: GameState, players: any[], deaths: Death[], results: PlayerResult[]): string {
    let explanation = '';

    for (const player of players) {
      if (player.status === 'dead') continue;

      switch (player.role) {
        case 'Lookout':
          explanation += this.executeLookout(player, gameState, results);
          break;
        case 'Veteran':
          explanation += this.executeVeteran(player, gameState, deaths, results);
          break;
        case 'Stalker':
          explanation += this.executeStalker(player, gameState, deaths, results);
          break;
        case 'Locksmith':
          explanation += this.executeLocksmith(player, gameState, results);
          break;
        case 'Patrolman':
          explanation += this.executePatrolman(player, gameState, deaths, results);
          break;
        case 'Sleepwalker':
          explanation += this.executeSleepwalker(player, gameState, deaths, results);
          break;
        case 'Orphan':
          explanation += this.executeOrphan(player, gameState, deaths, results);
          break;
      }
    }

    return explanation;
  }

  private executeBlocking(gameState: GameState, players: any[], deaths: Death[], results: PlayerResult[]): string {
    let explanation = '';

    for (const player of players) {
      if (player.status === 'dead') continue;

      switch (player.role) {
        case 'Jailkeeper':
          explanation += this.executeJailkeeper(player, gameState, deaths, results);
          break;
        case 'Escort':
          explanation += this.executeEscort(player, gameState, deaths, results);
          break;
        case 'Consort':
          explanation += this.executeConsort(player, gameState, deaths, results);
          break;
      }
    }

    return explanation;
  }

  private executeInfoGathering(gameState: GameState, players: any[], deaths: Death[], results: PlayerResult[]): string {
    let explanation = '';

    for (const player of players) {
      if (player.status === 'dead') continue;

      switch (player.role) {
        case 'Framer':
          explanation += this.executeFramer(player, gameState, results);
          break;
        case 'Seer':
          explanation += this.executeSeer(player, gameState, results);
          break;
        case 'Bartender':
          explanation += this.executeBartender(player, gameState, results);
          break;
        case 'Gravedigger':
          explanation += this.executeGravedigger(player, gameState, results);
          break;
        case 'Graverobber':
          explanation += this.executeGraverobber(player, gameState, results);
          break;
        case 'Clairvoyant':
          explanation += this.executeClairvoyant(player, gameState, results);
          break;
        case 'Bloodhound':
          explanation += this.executeBloodhound(player, gameState, results);
          break;
      }
    }

    return explanation;
  }

  private executeKilling(gameState: GameState, players: any[], deaths: Death[], results: PlayerResult[]): string {
    let explanation = '';

    for (const player of players) {
      if (player.status === 'dead') continue;

      switch (player.role) {
        case 'Hypnotist':
          explanation += this.executeHypnotist(player, gameState, results);
          break;
        case 'Hunter':
          explanation += this.executeHunter(player, gameState, deaths, results);
          break;
        case 'Vigilante':
          explanation += this.executeVigilante(player, gameState, deaths, results);
          break;
        case 'Arsonist':
          explanation += this.executeArsonistDouse(player, gameState, results);
          break;
        case 'Plague Bringer':
          explanation += this.executePlagueBringer(player, gameState, results);
          break;
        case 'Serial Killer':
          explanation += this.executeSerialKiller(player, gameState, deaths, results);
          break;
        case 'Glutton':
          explanation += this.executeGlutton(player, gameState, deaths, results);
          break;
        case 'Alpha Wolf':
          explanation += this.executeAlphaWolf(player, gameState, deaths, results);
          break;
      }
    }

    return explanation;
  }

  private executeHealing(gameState: GameState, players: any[], deaths: Death[], results: PlayerResult[]): string {
    let explanation = '';

    for (const player of players) {
      if (player.status === 'dead') continue;

      if (player.role === 'Doctor') {
        explanation += this.executeDoctor(player, gameState, deaths, results);
      }
    }

    return explanation;
  }

  // Individual role execution methods
  private executeLookout(player: any, gameState: GameState, results: PlayerResult[]): string {
    if (!player.actionNotes) return '';

    const target = gameState.players.find(p => p.username === player.actionNotes);
    if (!target || target.status === 'dead') {
      results.push({
        player: player.username,
        resultMessage: 'failed'
      });
      return `Lookout ${player.username} failed to watch target.\n`;
    }

    // Determine what the lookout sees
    let destination = 'stayed home';
    if (target.actionNotes && target.actionNotes !== 'none') {
      destination = `traveled to ${target.actionNotes}`;
    }

    results.push({
      player: player.username,
      resultMessage: `${target.username} ${destination}`
    });

    return `Lookout ${player.username} watched ${target.username} who ${destination}.\n`;
  }

  private executeVeteran(player: any, gameState: GameState, deaths: Death[], results: PlayerResult[]): string {
    if (!player.actionNotes || !player.actionNotes.includes('alert')) return '';

    // Find all players who visited the veteran
    const visitors = gameState.players.filter(p => 
      p.actionNotes === player.username && p.moves && p.status === 'alive'
    );

    if (visitors.length > 0) {
      for (const visitor of visitors) {
        deaths.push({
          player: visitor.username,
          cause: 'vanished without a trace',
          killer: 'Veteran',
          location: 'veteran home',
          flavor: 'vanished'
        });
        visitor.status = 'dead';
        visitor.killedBy = 'Veteran';
        visitor.killFlavor = 'vanished';
      }

      results.push({
        player: player.username,
        resultMessage: `Alert successful. ${visitors.length} visitors killed.`
      });

      return `Veteran ${player.username} went on alert and killed ${visitors.length} visitors.\n`;
    }

    results.push({
      player: player.username,
      resultMessage: 'Alert expended with no visitors.'
    });

    return `Veteran ${player.username} went on alert but no one visited.\n`;
  }

  private executeStalker(player: any, gameState: GameState, deaths: Death[], results: PlayerResult[]): string {
    if (!player.actionNotes || player.chargesLeft <= 0) return '';

    const target = gameState.players.find(p => p.username === player.actionNotes);
    if (!target || target.status === 'dead') {
      results.push({
        player: player.username,
        resultMessage: 'failed'
      });
      return `Stalker ${player.username} failed to stalk target.\n`;
    }

    // Check if target moved
    if (target.actionNotes && target.actionNotes !== 'none' && target.actionNotes !== target.username) {
      deaths.push({
        player: target.username,
        cause: 'slashed to death on front porch',
        killer: 'Stalker',
        location: 'front porch',
        flavor: 'slashed'
      });
      target.status = 'dead';
      target.killedBy = 'Stalker';
      target.killFlavor = 'slashed';

      results.push({
        player: player.username,
        resultMessage: `Successfully killed ${target.username}`
      });

      return `Stalker ${player.username} killed ${target.username} who was moving.\n`;
    } else {
      results.push({
        player: player.username,
        resultMessage: 'Target did not move'
      });

      return `Stalker ${player.username} failed to kill ${target.username} who did not move.\n`;
    }
  }

  private executeLocksmith(player: any, gameState: GameState, results: PlayerResult[]): string {
    if (!player.actionNotes) return '';

    const target = gameState.players.find(p => p.username === player.actionNotes);
    if (!target || target.status === 'dead') {
      results.push({
        player: player.username,
        resultMessage: 'failed'
      });
      return `Locksmith ${player.username} failed to lock target.\n`;
    }

    target.isLocked = true;
    results.push({
      player: player.username,
      resultMessage: `Successfully locked ${target.username}'s house`
    });

    return `Locksmith ${player.username} locked ${target.username}'s house.\n`;
  }

  private executePatrolman(player: any, gameState: GameState, deaths: Death[], results: PlayerResult[]): string {
    if (!player.actionNotes) return '';

    const target = gameState.players.find(p => p.username === player.actionNotes);
    if (!target || target.status === 'dead') {
      results.push({
        player: player.username,
        resultMessage: 'failed'
      });
      return `Patrolman ${player.username} failed to patrol target.\n`;
    }

    // Check if any killers visited the target
    const killers = gameState.players.filter(p => 
      p.actionNotes === target.username && 
      ['Alpha Wolf', 'Serial Killer', 'Murderer', 'Arsonist'].includes(p.role) &&
      p.status === 'alive'
    );

    if (killers.length > 0) {
      // Patrolman kills the killer and dies
      const killer = killers[0];
      deaths.push({
        player: killer.username,
        cause: 'killed in fight with Patrolman',
        killer: 'Patrolman',
        location: `${target.username}'s front yard`,
        flavor: 'fight'
      });
      deaths.push({
        player: player.username,
        cause: 'killed in fight with killer',
        killer: killer.role,
        location: `${target.username}'s front yard`,
        flavor: 'fight'
      });

      killer.status = 'dead';
      killer.killedBy = 'Patrolman';
      player.status = 'dead';
      player.killedBy = killer.role;

      results.push({
        player: player.username,
        resultMessage: `Killed ${killer.username} in fight`
      });

      return `Patrolman ${player.username} killed ${killer.username} in a fight at ${target.username}'s house.\n`;
    } else {
      results.push({
        player: player.username,
        resultMessage: 'No killers visited target'
      });

      return `Patrolman ${player.username} patrolled ${target.username}'s house but no killers visited.\n`;
    }
  }

  private executeSleepwalker(player: any, gameState: GameState, deaths: Death[], results: PlayerResult[]): string {
    if (!player.actionNotes) return '';

    // Parse the two players to avoid
    const avoidPlayers = player.actionNotes.split(',').map((p: string) => p.trim());
    
    // Find a random house to visit (excluding own and avoided)
    const availableHouses = gameState.players.filter(p => 
      p.status === 'alive' && 
      p.username !== player.username && 
      !avoidPlayers.includes(p.username)
    );

    if (availableHouses.length === 0) {
      results.push({
        player: player.username,
        resultMessage: 'No available houses to visit'
      });
      return `Sleepwalker ${player.username} had no houses to visit.\n`;
    }

    const randomHouse = availableHouses[Math.floor(Math.random() * availableHouses.length)];
    
    // Check if the house was attacked
    const attackers = gameState.players.filter(p => 
      p.actionNotes === randomHouse.username && 
      ['Alpha Wolf', 'Serial Killer', 'Murderer', 'Arsonist'].includes(p.role) &&
      p.status === 'alive'
    );

    if (attackers.length > 0) {
      deaths.push({
        player: player.username,
        cause: 'killed by same attack as target',
        killer: attackers[0].role,
        location: randomHouse.username,
        flavor: 'same attack'
      });
      player.status = 'dead';
      player.killedBy = attackers[0].role;
    }

    results.push({
      player: player.username,
      resultMessage: 'Wandered to unknown location'
    });

    return `Sleepwalker ${player.username} wandered to ${randomHouse.username}'s house.\n`;
  }

  private executeOrphan(player: any, gameState: GameState, deaths: Death[], results: PlayerResult[]): string {
    if (!player.actionNotes) return '';

    const target = gameState.players.find(p => p.username === player.actionNotes);
    if (!target || target.status === 'dead') {
      results.push({
        player: player.username,
        resultMessage: 'failed'
      });
      return `Orphan ${player.username} failed to visit target.\n`;
    }

    // Check if target was attacked
    const attackers = gameState.players.filter(p => 
      p.actionNotes === target.username && 
      ['Alpha Wolf', 'Serial Killer', 'Murderer', 'Arsonist'].includes(p.role) &&
      p.status === 'alive'
    );

    if (attackers.length > 0) {
      deaths.push({
        player: player.username,
        cause: 'killed by same attack as target',
        killer: attackers[0].role,
        location: target.username,
        flavor: 'same attack'
      });
      player.status = 'dead';
      player.killedBy = attackers[0].role;
    }

    // Update conversion progress
    if (!player.conversionProgress) player.conversionProgress = 0;
    player.conversionProgress++;
    player.conversionTarget = target.username;

    if (player.conversionProgress >= 3) {
      results.push({
        player: player.username,
        resultMessage: `Successfully converted to ${target.role}`
      });
    } else {
      results.push({
        player: player.username,
        resultMessage: `Conversion progress: ${player.conversionProgress}/3`
      });
    }

    return `Orphan ${player.username} visited ${target.username} (${player.conversionProgress}/3).\n`;
  }

  private executeJailkeeper(player: any, gameState: GameState, deaths: Death[], results: PlayerResult[]): string {
    if (!player.actionNotes) return '';

    const target = gameState.players.find(p => p.username === player.actionNotes);
    if (!target || target.status === 'dead') {
      results.push({
        player: player.username,
        resultMessage: 'failed'
      });
      return `Jailkeeper ${player.username} failed to jail target.\n`;
    }

    target.isJailed = true;
    results.push({
      player: player.username,
      resultMessage: `Successfully jailed ${target.username}`
    });

    return `Jailkeeper ${player.username} jailed ${target.username}.\n`;
  }

  private executeEscort(player: any, gameState: GameState, deaths: Death[], results: PlayerResult[]): string {
    if (!player.actionNotes) return '';

    const target = gameState.players.find(p => p.username === player.actionNotes);
    if (!target || target.status === 'dead') {
      results.push({
        player: player.username,
        resultMessage: 'failed'
      });
      return `Escort ${player.username} failed to escort target.\n`;
    }

    // Check if target is a killer
    if (['Serial Killer', 'Murderer'].includes(target.role)) {
      deaths.push({
        player: player.username,
        cause: 'killed by neutral killer',
        killer: target.role,
        location: 'townsquare',
        flavor: target.role === 'Serial Killer' ? 'stabbed' : 'axe wounds'
      });
      player.status = 'dead';
      player.killedBy = target.role;
      player.bodyLocation = 'townsquare';

      results.push({
        player: player.username,
        resultMessage: `Killed by ${target.role}`
      });

      return `Escort ${player.username} was killed by ${target.role}.\n`;
    }

    target.isEscorted = true;
    results.push({
      player: player.username,
      resultMessage: `Successfully escorted ${target.username}`
    });

    return `Escort ${player.username} escorted ${target.username}.\n`;
  }

  private executeConsort(player: any, gameState: GameState, deaths: Death[], results: PlayerResult[]): string {
    if (!player.actionNotes) return '';

    const target = gameState.players.find(p => p.username === player.actionNotes);
    if (!target || target.status === 'dead') {
      results.push({
        player: player.username,
        resultMessage: 'failed'
      });
      return `Consort ${player.username} failed to consort target.\n`;
    }

    // Check if target is a killer
    if (['Serial Killer', 'Murderer'].includes(target.role)) {
      deaths.push({
        player: player.username,
        cause: 'killed by neutral killer',
        killer: target.role,
        location: 'townsquare',
        flavor: target.role === 'Serial Killer' ? 'stabbed' : 'axe wounds'
      });
      player.status = 'dead';
      player.killedBy = target.role;
      player.bodyLocation = 'townsquare';

      results.push({
        player: player.username,
        resultMessage: `Killed by ${target.role}`
      });

      return `Consort ${player.username} was killed by ${target.role}.\n`;
    }

    target.isConsorted = true;
    results.push({
      player: player.username,
      resultMessage: `Successfully consorted ${target.username}`
    });

    return `Consort ${player.username} consorted ${target.username}.\n`;
  }

  private executeFramer(player: any, gameState: GameState, results: PlayerResult[]): string {
    if (!player.actionNotes) return '';

    const target = gameState.players.find(p => p.username === player.actionNotes);
    if (!target || target.status === 'dead') {
      results.push({
        player: player.username,
        resultMessage: 'failed'
      });
      return `Framer ${player.username} failed to frame target.\n`;
    }

    target.isFramed = true;
    target.framedNight = gameState.nightNumber;
    results.push({
      player: player.username,
      resultMessage: `Successfully framed ${target.username}`
    });

    return `Framer ${player.username} framed ${target.username}.\n`;
  }

  private executeSeer(player: any, gameState: GameState, results: PlayerResult[]): string {
    if (!player.actionNotes) return '';

    const target = gameState.players.find(p => p.username === player.actionNotes);
    if (!target || target.status === 'dead') {
      results.push({
        player: player.username,
        resultMessage: 'failed'
      });
      return `Seer ${player.username} failed to investigate target.\n`;
    }

    let roleToShow = target.role;
    if (target.isFramed) {
      // Show random wolf role
      const wolfRoles = gameState.roles.filter(r => r.team === 'Wolf').map(r => r.name);
      roleToShow = wolfRoles[Math.floor(Math.random() * wolfRoles.length)];
    }

    results.push({
      player: player.username,
      resultMessage: roleToShow
    });

    return `Seer ${player.username} investigated ${target.username} and saw ${roleToShow}.\n`;
  }

  private executeBartender(player: any, gameState: GameState, results: PlayerResult[]): string {
    if (!player.actionNotes) return '';

    const target = gameState.players.find(p => p.username === player.actionNotes);
    if (!target || target.status === 'dead') {
      results.push({
        player: player.username,
        resultMessage: 'failed'
      });
      return `Bartender ${player.username} failed to visit target.\n`;
    }

    if (target.isFramed) {
      // Give three lies
      const availableRoles = gameState.roles
        .filter(r => !['Sleepwalker', 'Orphan', 'Lone Wolf'].includes(r.name))
        .map(r => r.name);
      
      const lies = [];
      for (let i = 0; i < 3; i++) {
        lies.push(availableRoles[Math.floor(Math.random() * availableRoles.length)]);
      }

      results.push({
        player: player.username,
        resultMessage: lies.join(' / ')
      });

      return `Bartender ${player.username} visited framed ${target.username} and received three lies.\n`;
    } else {
      // Give true role + two lies
      const availableRoles = gameState.roles
        .filter(r => !['Sleepwalker', 'Orphan', 'Lone Wolf'].includes(r.name))
        .map(r => r.name);
      
      const roles = [target.role];
      while (roles.length < 3) {
        const randomRole = availableRoles[Math.floor(Math.random() * availableRoles.length)];
        if (!roles.includes(randomRole)) {
          roles.push(randomRole);
        }
      }

      results.push({
        player: player.username,
        resultMessage: roles.join(' / ')
      });

      return `Bartender ${player.username} visited ${target.username} and received role information.\n`;
    }
  }

  private executeGravedigger(player: any, gameState: GameState, results: PlayerResult[]): string {
    if (!player.actionNotes) return '';

    const target = gameState.players.find(p => p.username === player.actionNotes);
    if (!target || target.status !== 'dead') {
      results.push({
        player: player.username,
        resultMessage: 'failed'
      });
      return `Gravedigger ${player.username} failed to dig target.\n`;
    }

    let roleToShow = target.role;
    if (target.isFramed) {
      // Show random wolf role
      const wolfRoles = gameState.roles.filter(r => r.team === 'Wolf').map(r => r.name);
      roleToShow = wolfRoles[Math.floor(Math.random() * wolfRoles.length)];
    }

    results.push({
      player: player.username,
      resultMessage: roleToShow
    });

    return `Gravedigger ${player.username} dug up ${target.username} and found ${roleToShow}.\n`;
  }

  private executeGraverobber(player: any, gameState: GameState, results: PlayerResult[]): string {
    if (!player.actionNotes) return '';

    const target = gameState.players.find(p => p.username === player.actionNotes);
    if (!target || target.status !== 'dead') {
      results.push({
        player: player.username,
        resultMessage: 'failed'
      });
      return `Graverobber ${player.username} failed to rob target.\n`;
    }

    // Convert to the dead player's role
    player.role = target.role;
    player.team = target.team;

    results.push({
      player: player.username,
      resultMessage: `Successfully assumed role of ${target.role}`
    });

    return `Graverobber ${player.username} assumed the role of ${target.role}.\n`;
  }

  private executeClairvoyant(player: any, gameState: GameState, results: PlayerResult[]): string {
    if (!player.actionNotes) return '';

    const target = gameState.players.find(p => p.username === player.actionNotes);
    if (!target || target.status === 'dead') {
      results.push({
        player: player.username,
        resultMessage: 'failed'
      });
      return `Clairvoyant ${player.username} failed to investigate target.\n`;
    }

    results.push({
      player: player.username,
      resultMessage: target.role
    });

    return `Clairvoyant ${player.username} investigated ${target.username} and found ${target.role}.\n`;
  }

  private executeBloodhound(player: any, gameState: GameState, results: PlayerResult[]): string {
    if (!player.actionNotes) return '';

    const targetRole = player.actionNotes;
    const playersWithRole = gameState.players.filter(p => p.role === targetRole && p.status === 'alive');
    
    if (playersWithRole.length === 0) {
      results.push({
        player: player.username,
        resultMessage: 'failure'
      });
      return `Bloodhound ${player.username} failed to find ${targetRole}.\n`;
    }

    const alivePlayers = gameState.players.filter(p => p.status === 'alive');
    const names = [playersWithRole[0].username];
    
    while (names.length < 3) {
      const randomPlayer = alivePlayers[Math.floor(Math.random() * alivePlayers.length)];
      if (!names.includes(randomPlayer.username)) {
        names.push(randomPlayer.username);
      }
    }

    results.push({
      player: player.username,
      resultMessage: names.join(' / ')
    });

    return `Bloodhound ${player.username} searched for ${targetRole} and found ${names.join(', ')}.\n`;
  }

  private executeHypnotist(player: any, gameState: GameState, results: PlayerResult[]): string {
    if (!player.actionNotes) return '';

    const target = gameState.players.find(p => p.username === player.actionNotes);
    if (!target || target.status === 'dead') {
      results.push({
        player: player.username,
        resultMessage: 'failed'
      });
      return `Hypnotist ${player.username} failed to hypnotize target.\n`;
    }

    target.hypnotizedBy = player.username;
    target.hypnotizedUntil = gameState.nightNumber + 1;

    results.push({
      player: player.username,
      resultMessage: `Successfully hypnotized ${target.username}`
    });

    return `Hypnotist ${player.username} hypnotized ${target.username}.\n`;
  }

  private executeHunter(player: any, gameState: GameState, deaths: Death[], results: PlayerResult[]): string {
    if (!player.actionNotes || player.chargesLeft <= 0) return '';

    const target = gameState.players.find(p => p.username === player.actionNotes);
    if (!target || target.status === 'dead') {
      results.push({
        player: player.username,
        resultMessage: 'failed'
      });
      return `Hunter ${player.username} failed to shoot target.\n`;
    }

    deaths.push({
      player: target.username,
      cause: 'shot',
      killer: 'Hunter',
      location: 'shot',
      flavor: 'bullet holes'
    });
    target.status = 'dead';
    target.killedBy = 'Hunter';
    target.killFlavor = 'bullet holes';

    results.push({
      player: player.username,
      resultMessage: `Successfully shot ${target.username}`
    });

    return `Hunter ${player.username} shot ${target.username}.\n`;
  }

  private executeVigilante(player: any, gameState: GameState, deaths: Death[], results: PlayerResult[]): string {
    if (!player.actionNotes || player.chargesLeft <= 0) return '';

    const target = gameState.players.find(p => p.username === player.actionNotes);
    if (!target || target.status === 'dead') {
      results.push({
        player: player.username,
        resultMessage: 'failed'
      });
      return `Vigilante ${player.username} failed to shoot target.\n`;
    }

    deaths.push({
      player: target.username,
      cause: 'shot',
      killer: 'Vigilante',
      location: 'shot',
      flavor: 'bullet holes'
    });
    target.status = 'dead';
    target.killedBy = 'Vigilante';
    target.killFlavor = 'bullet holes';

    results.push({
      player: player.username,
      resultMessage: `Successfully shot ${target.username}`
    });

    return `Vigilante ${player.username} shot ${target.username}.\n`;
  }

  private executeArsonistDouse(player: any, gameState: GameState, results: PlayerResult[]): string {
    if (!player.actionNotes || !player.actionNotes.includes('douse')) return '';

    const target = gameState.players.find(p => p.username === player.actionNotes.replace('douse ', ''));
    if (!target || target.status === 'dead') {
      results.push({
        player: player.username,
        resultMessage: 'failed'
      });
      return `Arsonist ${player.username} failed to douse target.\n`;
    }

    target.isDoused = true;
    results.push({
      player: player.username,
      resultMessage: `Successfully doused ${target.username}`
    });

    return `Arsonist ${player.username} doused ${target.username}.\n`;
  }

  private executePlagueBringer(player: any, gameState: GameState, results: PlayerResult[]): string {
    if (!player.actionNotes) return '';

    const target = gameState.players.find(p => p.username === player.actionNotes);
    if (!target || target.status === 'dead') {
      results.push({
        player: player.username,
        resultMessage: 'failed'
      });
      return `Plague Bringer ${player.username} failed to infect target.\n`;
    }

    // Infect target and visitors
    const visitors = gameState.players.filter(p => 
      p.actionNotes === target.username && p.status === 'alive'
    );

    const allInfected = [target, ...visitors];
    for (const infected of allInfected) {
      if (!infected.isInfected) {
        infected.isInfected = true;
        infected.infectionDay = gameState.nightNumber;
      } else {
        // Second infection makes them a carrier
        infected.isCarrier = true;
        infected.isInfected = false; // Carriers don't die
      }
    }

    results.push({
      player: player.username,
      resultMessage: `Successfully infected ${allInfected.length} players`
    });

    return `Plague Bringer ${player.username} infected ${allInfected.length} players.\n`;
  }

  private executeSerialKiller(player: any, gameState: GameState, deaths: Death[], results: PlayerResult[]): string {
    if (!player.actionNotes) return '';

    const target = gameState.players.find(p => p.username === player.actionNotes);
    if (!target || target.status === 'dead') {
      results.push({
        player: player.username,
        resultMessage: 'failed'
      });
      return `Serial Killer ${player.username} failed to kill target.\n`;
    }

    deaths.push({
      player: target.username,
      cause: 'stabbed to death',
      killer: 'Serial Killer',
      location: 'stabbed',
      flavor: 'stabbed'
    });
    target.status = 'dead';
    target.killedBy = 'Serial Killer';
    target.killFlavor = 'stabbed';

    results.push({
      player: player.username,
      resultMessage: `Successfully killed ${target.username}`
    });

    return `Serial Killer ${player.username} killed ${target.username}.\n`;
  }

  private executeGlutton(player: any, gameState: GameState, deaths: Death[], results: PlayerResult[]): string {
    if (!player.actionNotes || player.chargesLeft <= 0) return '';

    const target = gameState.players.find(p => p.username === player.actionNotes);
    if (!target || target.status === 'dead') {
      results.push({
        player: player.username,
        resultMessage: 'failed'
      });
      return `Glutton ${player.username} failed to eat target.\n`;
    }

    // Check if target moved
    if (target.actionNotes && target.actionNotes !== 'none' && target.actionNotes !== target.username) {
      results.push({
        player: player.username,
        resultMessage: 'Target moved, failed to eat'
      });
      return `Glutton ${player.username} failed to eat ${target.username} who was moving.\n`;
    }

    deaths.push({
      player: target.username,
      cause: 'eaten whole',
      killer: 'Glutton',
      location: 'eaten',
      flavor: 'vanished without a trace'
    });
    target.status = 'dead';
    target.killedBy = 'Glutton';
    target.killFlavor = 'vanished without a trace';

    results.push({
      player: player.username,
      resultMessage: `Successfully ate ${target.username}`
    });

    return `Glutton ${player.username} ate ${target.username}.\n`;
  }

  private executeAlphaWolf(player: any, gameState: GameState, deaths: Death[], results: PlayerResult[]): string {
    if (!player.actionNotes) return '';

    const target = gameState.players.find(p => p.username === player.actionNotes);
    if (!target || target.status === 'dead') {
      results.push({
        player: player.username,
        resultMessage: 'failed'
      });
      return `Alpha Wolf ${player.username} failed to kill target.\n`;
    }

    deaths.push({
      player: target.username,
      cause: 'killed by Alpha Wolf',
      killer: 'Alpha Wolf',
      location: 'blood and fur',
      flavor: 'blood and fur'
    });
    target.status = 'dead';
    target.killedBy = 'Alpha Wolf';
    target.killFlavor = 'blood and fur';

    results.push({
      player: player.username,
      resultMessage: `Successfully killed ${target.username}`
    });

    return `Alpha Wolf ${player.username} killed ${target.username}.\n`;
  }

  private executeDoctor(player: any, gameState: GameState, deaths: Death[], results: PlayerResult[]): string {
    if (!player.actionNotes) return '';

    const target = gameState.players.find(p => p.username === player.actionNotes);
    if (!target || target.status === 'dead') {
      results.push({
        player: player.username,
        resultMessage: 'failed'
      });
      return `Doctor ${player.username} failed to heal target.\n`;
    }

    // Check if target was killed this night
    const killedThisNight = deaths.find(d => d.player === target.username);
    if (killedThisNight) {
      // Remove the death
      const deathIndex = deaths.findIndex(d => d.player === target.username);
      if (deathIndex !== -1) {
        deaths.splice(deathIndex, 1);
      }
      target.status = 'alive';
      target.killedBy = undefined;
      target.killFlavor = undefined;

      results.push({
        player: player.username,
        resultMessage: `Successfully healed ${target.username}`
      });

      return `Doctor ${player.username} healed ${target.username} from death.\n`;
    } else {
      results.push({
        player: player.username,
        resultMessage: `No healing needed for ${target.username}`
      });

      return `Doctor ${player.username} attempted to heal ${target.username} but no healing was needed.\n`;
    }
  }

  private loadRules(rulesPath: string): GameRules {
    const rulesData = fs.readFileSync(rulesPath, 'utf8');
    return JSON.parse(rulesData);
  }
} 