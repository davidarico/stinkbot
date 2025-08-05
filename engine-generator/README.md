# Werewolf Game Engine

A deterministic game engine for calculating night actions in Werewolf (Mafia-like social deception games). This engine replaces the need for AI-based calculations with predictable, rule-based logic.

## Features

- **Deterministic Night Action Calculation**: Predictable outcomes based on game rules
- **Role Input Requirements**: Specifies what input is needed from moderators for each role
- **Order of Operations**: Follows the correct sequence for night actions
- **Comprehensive Role Support**: All roles from the game with their specific logic
- **Framing Effects**: Handles all framing interactions correctly
- **Cross-Night State Tracking**: Tracks effects that persist across multiple nights
- **Robust Testing**: Comprehensive test suite for all game logic

## Architecture

The engine is built with a modular architecture:

- **GameEngine**: Main orchestrator that coordinates all components
- **RuleEngine**: Handles game rules and order of operations
- **RoleEngine**: Manages role-specific logic and validation
- **DatabaseAdapter**: Interfaces with the game database

## Installation

```bash
npm install
npm run build
```

## Usage

### Basic Usage

```typescript
import { GameEngine } from './dist/index';

const engine = new GameEngine({
  rulesPath: './rules.json',
  rolesPath: './roles.json'
});

// Get input requirements for a role
const requirements = engine.getRoleInputRequirements(14); // Seer role
console.log(requirements);
// Output: {
//   roleId: 14,
//   roleName: 'Seer',
//   inputType: 'player_dropdown',
//   description: 'Select a player to investigate',
//   validation: 'Target must be alive',
//   options: ['alive_players'],
//   multiSelect: false,
//   allowNone: false
// }

// Calculate night actions
const actions = [
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

const result = await engine.calculateNightActions(1, 1, actions);
console.log(result);
// Output: {
//   deaths: [
//     { player: 'Player1', cause: 'killed by Alpha Wolf', flavor: 'blood and fur' }
//   ],
//   results: [
//     { player: 'Player1', resultMessage: 'Alpha Wolf' }
//   ],
//   explanation: 'Seer Player1 investigated Player2 and saw Alpha Wolf...'
// }
```

### Role Input Requirements

The engine provides detailed input requirements for each role:

```typescript
// Get all available roles
const roles = engine.getAllRoles();

// Get role by name
const seer = engine.getRoleByName('Seer');

// Get role by ID
const alphaWolf = engine.getRoleById(18);
```

### Action Validation

```typescript
// Validate if an action is valid for a role
const isValid = engine.validateAction(14, action, gameState);
```

## Data Files

### rules.json

Contains all game rules in a structured format:

```json
{
  "orderOfOperations": [
    {
      "name": "Arson (Lighting)",
      "description": "Arsonist lighting action precedes all other actions",
      "roles": ["Arsonist"],
      "action": "light"
    }
  ],
  "rampageMechanics": {
    "rampageableRoles": ["Escort", "Sleepwalker", "Orphan", "Lone Wolf"],
    "nonRampageableRoles": ["Consort"]
  }
}
```

### roles.json

Contains all role definitions with their properties:

```json
{
  "roles": [
    {
      "id": 14,
      "name": "Seer",
      "team": "Town",
      "targets": "Players",
      "moves": false,
      "description": "The Seer may select a player every night and will receive their role.",
      "framerInteraction": "The Seer will receive a random role from any wolf role in the game.",
      "inputRequirements": {
        "type": "player_dropdown",
        "description": "Select a player to investigate",
        "validation": "Target must be alive"
      }
    }
  ]
}
```

## Database Schema

The engine uses a `game_meta` table to track cross-night information:

```sql
CREATE TABLE game_meta (
    id SERIAL PRIMARY KEY,
    game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    user_id VARCHAR(20) NOT NULL,
    night INTEGER NOT NULL,
    meta_data JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(game_id, user_id, night)
);
```

This table stores information like:
- Hypnotist effects
- Auraseer balls
- Conversion progress
- Doused players
- Infected players

## Testing

Run the test suite:

```bash
npm test
```

Run tests in watch mode:

```bash
npm run test:watch
```

The test suite covers:
- Game engine functionality
- Rule engine logic
- Role engine validation
- Individual role behaviors
- Framing effects
- Order of operations

## Order of Operations

The engine follows the correct order of operations:

1. **Arson (Lighting)**: Arsonist lights all doused players
2. **Misc First Moves**: Lookout, Veteran, Stalker, Locksmith, Patrolman, Sleepwalker, Orphan
3. **Blocking Roles**: Jailkeeper, Escort, Consort
4. **Info Roles**: Framer, Seer, Bartender, Gravedigger, Graverobber, Clairvoyant, Bloodhound
5. **Killing Roles**: Hypnotist, Hunter, Vigilante, Arsonist, Plague Bringer, Serial Killer, Glutton, Alpha Wolf
6. **Last but Not Least**: Doctor (healing)

## Role Input Types

The engine supports various input types for different roles:

- `none`: No input required (Villager, Couple)
- `player_dropdown`: Select a single player (Seer, Doctor, Alpha Wolf)
- `two_player_dropdown`: Select two players (Sleepwalker, Matchmaker)
- `dead_player_dropdown`: Select a dead player (Gravedigger, Graverobber)
- `role_dropdown`: Select a role (Bloodhound)
- `alert_toggle`: Toggle alert on/off (Veteran)
- `arsonist_action`: Choose douse or light (Arsonist)

## Integration

To integrate with the frontend, replace the OpenAI-based calculation:

```typescript
// Old OpenAI-based approach
const openaiResult = await openai.chat.completions.create({
  model: "o4-mini-2025-04-16",
  messages: [...],
  tools: [tools]
});

// New deterministic approach
const engine = new GameEngine({
  rulesPath: './rules.json',
  rolesPath: './roles.json'
});

const result = await engine.calculateNightActions(gameId, nightNumber, actions);
```

## AI Regeneration

The engine is designed to be easily regenerated by AI when rules or roles change. The JSON files provide a structured format that AI can understand and modify. The modular architecture allows for easy updates to specific components without affecting the entire system.

## Contributing

1. Add new roles to `roles.json`
2. Update rules in `rules.json` if needed
3. Add role-specific logic to `rule-engine.ts`
4. Add validation logic to `role-engine.ts`
5. Write tests for new functionality
6. Update documentation

## License

This project is part of the Werewolf Discord Bot system. 