#!/usr/bin/env node

/**
 * Engine Generation Script
 * 
 * This script can be used by AI to regenerate the game engine code
 * when rules or roles are updated. It reads the JSON files and
 * can regenerate the TypeScript code accordingly.
 */

const fs = require('fs');
const path = require('path');

// Read the JSON files
const rulesPath = path.join(__dirname, '../rules.json');
const rolesPath = path.join(__dirname, '../roles.json');

function readJsonFile(filePath) {
  try {
    const data = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error(`Error reading ${filePath}:`, error.message);
    return null;
  }
}

function generateRoleValidationMethods(roles) {
  let code = '';
  
  for (const role of roles) {
    const roleName = role.name;
    const methodName = `validate${roleName.replace(/\s+/g, '')}Action`;
    
    code += `  private ${methodName}(action: NightAction, gameState: GameState): boolean {\n`;
    code += `    if (!action.target) return false;\n\n`;
    code += `    const target = gameState.players.find(p => p.username === action.target);\n`;
    code += `    if (!target || target.status !== 'alive') return false;\n\n`;
    
    // Add role-specific validation logic
    if (role.inputRequirements.type === 'two_player_dropdown') {
      code += `    if (!action.secondaryTarget) return false;\n\n`;
      code += `    const target2 = gameState.players.find(p => p.username === action.secondaryTarget);\n`;
      code += `    if (!target2 || target2.status !== 'alive') return false;\n\n`;
    }
    
    if (role.hasCharges) {
      code += `    const ${roleName.toLowerCase().replace(/\s+/g, '')} = gameState.players.find(p => p.id === action.playerId);\n`;
      code += `    if (${roleName.toLowerCase().replace(/\s+/g, '')} && ${roleName.toLowerCase().replace(/\s+/g, '')}.chargesLeft <= 0) return false;\n\n`;
    }
    
    // Add UTAH validation for roles that need it
    if (['Bartender', 'Escort', 'Jailkeeper', 'Hunter', 'Alpha Wolf', 'Clairvoyant', 'Consort', 'Glutton', 'Hypnotist', 'Murderer', 'Serial Killer'].includes(roleName)) {
      code += `    // Check if target is untargetable at home (UTAH)\n`;
      code += `    if (['Sleepwalker', 'Orphan', 'Lone Wolf'].includes(target.role)) {\n`;
      code += `      return false;\n`;
      code += `    }\n\n`;
    }
    
    code += `    return true;\n`;
    code += `  }\n\n`;
  }
  
  return code;
}

function generateRoleExecutionMethods(roles) {
  let code = '';
  
  for (const role of roles) {
    const roleName = role.name;
    const methodName = `execute${roleName.replace(/\s+/g, '')}`;
    
    code += `  private ${methodName}(player: any, gameState: GameState, deaths: Death[], results: PlayerResult[]): string {\n`;
    code += `    if (!player.actionNotes) return '';\n\n`;
    
    // Add role-specific execution logic
    if (roleName === 'Seer') {
      code += `    const target = gameState.players.find(p => p.username === player.actionNotes);\n`;
      code += `    if (!target || target.status === 'dead') {\n`;
      code += `      results.push({\n`;
      code += `        player: player.username,\n`;
      code += `        resultMessage: 'failed'\n`;
      code += `      });\n`;
      code += `      return \`Seer \${player.username} failed to investigate target.\\n\`;\n`;
      code += `    }\n\n`;
      code += `    let roleToShow = target.role;\n`;
      code += `    if (target.isFramed) {\n`;
      code += `      // Show random wolf role\n`;
      code += `      const wolfRoles = gameState.roles.filter(r => r.team === 'Wolf').map(r => r.name);\n`;
      code += `      roleToShow = wolfRoles[Math.floor(Math.random() * wolfRoles.length)];\n`;
      code += `    }\n\n`;
      code += `    results.push({\n`;
      code += `      player: player.username,\n`;
      code += `      resultMessage: roleToShow\n`;
      code += `    });\n\n`;
      code += `    return \`Seer \${player.username} investigated \${target.username} and saw \${roleToShow}.\\n\`;\n`;
    } else if (roleName === 'Alpha Wolf') {
      code += `    const target = gameState.players.find(p => p.username === player.actionNotes);\n`;
      code += `    if (!target || target.status === 'dead') {\n`;
      code += `      results.push({\n`;
      code += `        player: player.username,\n`;
      code += `        resultMessage: 'failed'\n`;
      code += `      });\n`;
      code += `      return \`Alpha Wolf \${player.username} failed to kill target.\\n\`;\n`;
      code += `    }\n\n`;
      code += `    deaths.push({\n`;
      code += `      player: target.username,\n`;
      code += `      cause: 'killed by Alpha Wolf',\n`;
      code += `      killer: 'Alpha Wolf',\n`;
      code += `      location: 'blood and fur',\n`;
      code += `      flavor: 'blood and fur'\n`;
      code += `    });\n`;
      code += `    target.status = 'dead';\n`;
      code += `    target.killedBy = 'Alpha Wolf';\n`;
      code += `    target.killFlavor = 'blood and fur';\n\n`;
      code += `    results.push({\n`;
      code += `      player: player.username,\n`;
      code += `      resultMessage: \`Successfully killed \${target.username}\`\n`;
      code += `    });\n\n`;
      code += `    return \`Alpha Wolf \${player.username} killed \${target.username}.\\n\`;\n`;
    } else {
      // Generic implementation for other roles
      code += `    // TODO: Implement specific logic for ${roleName}\n`;
      code += `    results.push({\n`;
      code += `      player: player.username,\n`;
      code += `      resultMessage: 'action completed'\n`;
      code += `    });\n\n`;
      code += `    return \`${roleName} \${player.username} completed their action.\\n\`;\n`;
    }
    
    code += `  }\n\n`;
  }
  
  return code;
}

function generateEngineCode() {
  const rules = readJsonFile(rulesPath);
  const roles = readJsonFile(rolesPath);
  
  if (!rules || !roles) {
    console.error('Failed to read JSON files');
    process.exit(1);
  }
  
  console.log('Generating engine code from JSON files...');
  
  // Generate role validation methods
  const validationMethods = generateRoleValidationMethods(roles.roles);
  console.log('Generated validation methods for', roles.roles.length, 'roles');
  
  // Generate role execution methods
  const executionMethods = generateRoleExecutionMethods(roles.roles);
  console.log('Generated execution methods for', roles.roles.length, 'roles');
  
  // Write the generated code to a file
  const outputPath = path.join(__dirname, '../src/generated-role-methods.ts');
  const output = `// Auto-generated role methods
// This file is generated by the generate-engine.js script
// Do not edit manually

import { NightAction, GameState, Death, PlayerResult } from './types';

export class GeneratedRoleMethods {
${validationMethods}
${executionMethods}
}
`;
  
  fs.writeFileSync(outputPath, output);
  console.log('Generated code written to:', outputPath);
  
  // Generate TypeScript interfaces
  const interfacesPath = path.join(__dirname, '../src/generated-interfaces.ts');
  const interfaces = `// Auto-generated TypeScript interfaces
// This file is generated by the generate-engine.js script
// Do not edit manually

export interface GeneratedRole {
  id: number;
  name: string;
  team: 'Town' | 'Wolf' | 'Neutral';
  targets: string;
  moves: boolean;
  description: string;
  inputRequirements: {
    type: string;
    description: string;
    validation: string;
  };
}

export const GENERATED_ROLES: GeneratedRole[] = ${JSON.stringify(roles.roles, null, 2)};

export const GENERATED_RULES = ${JSON.stringify(rules, null, 2)};
`;
  
  fs.writeFileSync(interfacesPath, interfaces);
  console.log('Generated interfaces written to:', interfacesPath);
  
  console.log('Engine generation complete!');
}

// Run the generation if this script is executed directly
if (require.main === module) {
  generateEngineCode();
}

module.exports = { generateEngineCode }; 