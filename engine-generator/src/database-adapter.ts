import { Player, Role, GameMeta } from './types';
import { Pool } from 'pg';

export class DatabaseAdapter {
  private db: Pool | null;
  private useMock: boolean;

  constructor(databasePath?: string) {
    // Check if we should use mock data (for testing) or real database
    this.useMock = process.env.NODE_ENV === 'test' || !process.env.DATABASE_URL;
    
    if (this.useMock) {
      console.log('🔧 Using mock database for testing');
      this.db = null;
    } else {
      console.log('🔗 Connecting to real PostgreSQL database');
      this.db = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.DATABASE_URL?.includes('supabase') ? { rejectUnauthorized: false } : false,
      });
    }
  }

  async getPlayers(gameId: number): Promise<Player[]> {
    if (this.useMock) {
      // Mock implementation for testing
      return [
        {
          id: 1,
          username: 'Player1',
          status: 'alive',
          role: 'Seer',
          team: 'Town',
          isWolf: false,
          isFramed: false,
          chargesLeft: 3,
          actionNotes: 'Player2'
        },
        {
          id: 2,
          username: 'Player2',
          status: 'alive',
          role: 'Alpha Wolf',
          team: 'Wolf',
          isWolf: true,
          isFramed: false,
          chargesLeft: undefined,
          actionNotes: 'Player1'
        }
      ];
    }

    // Real database implementation
    try {
      const result = await this.db!.query(
        `SELECT p.*, r.name as role_name, r.team as role_team
         FROM players p 
         LEFT JOIN roles r ON p.role_id = r.id 
         WHERE p.game_id = $1 
         ORDER BY p.signed_up_at`,
        [gameId]
      );
      
      return result.rows.map(row => ({
        id: row.id,
        username: row.username,
        status: row.status,
        role: row.role_name,
        team: row.role_team,
        isWolf: row.is_wolf,
        isFramed: row.is_framed,
        chargesLeft: row.charges_left,
        actionNotes: undefined // Will be set by game engine
      }));
    } catch (error) {
      console.error('Error fetching players:', error);
      throw error;
    }
  }

  async getGameRoles(gameId: number): Promise<Role[]> {
    if (this.useMock) {
      // Mock implementation for testing
      return [
        {
          id: 1,
          name: 'Seer',
          team: 'Town',
          targets: 'Players',
          moves: false,
          description: 'The Seer may select a player every night and will receive their role.',
          framerInteraction: 'The Seer will receive a random role from any wolf role in the game.',
          specialProperties: ['The Seer is the only role in the game to receive info if jailed'],
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
          inWolfChat: true,
          description: 'Each night, the Alpha Wolf travels to a player\'s home and kills them.',
          standardResultsFlavor: 'Victims will be found dead with blood and fur near the body.',
          specialProperties: [
            'If there is a dispute among the wolves over who to kill, the Alpha Wolf has the final say',
            'If the Alpha Wolf dies, the Heir becomes the new Alpha Wolf (if in game), otherwise a new Alpha Wolf will be chosen by the wolves from amongst the alive "vanilla" wolves',
            'If no "vanilla" wolf is alive, the wolves must choose a new alpha from amongst any of the living wolves in wolf chat',
            'This player loses any role and abilities they had prior, as their new role is "Alpha Wolf"',
            'Info roles will see this player as the Alpha Wolf from then on',
            'The Alpha Wolf will fail if they attempt to target a UTAH role',
            'The Alpha Wolf may choose the same target twice in a row for their Night Action'
          ],
          inputRequirements: {
            type: 'player_dropdown',
            description: 'Select a player to kill',
            validation: 'Target must be alive and targetable at home'
          }
        }
      ];
    }

    // Real database implementation
    try {
      const result = await this.db!.query(
        `SELECT r.*, gr.role_count, gr.custom_name, gr.charges
         FROM game_role gr 
         JOIN roles r ON gr.role_id = r.id 
         WHERE gr.game_id = $1`,
        [gameId]
      );
      
      return result.rows.map(row => ({
        id: row.id,
        name: row.name,
        team: row.team,
        targets: row.targets,
        moves: row.moves,
        description: row.description,
        framerInteraction: row.framer_interaction,
        specialProperties: row.special_properties ? JSON.parse(row.special_properties) : [],
        inputRequirements: {
          type: this.getInputTypeForRole(row.name),
          description: this.getInputDescriptionForRole(row.name),
          validation: this.getInputValidationForRole(row.name)
        }
      }));
    } catch (error) {
      console.error('Error fetching game roles:', error);
      throw error;
    }
  }

  async getGameMeta(gameId: number, nightNumber: number): Promise<GameMeta[]> {
    if (this.useMock) {
      // Mock implementation for testing
      return [
        {
          gameId,
          userId: 'Player1',
          night: nightNumber,
          metaData: {
            hypnotizedBy: 'Player2',
            hypnotizedUntil: nightNumber + 1
          }
        }
      ];
    }

    // Real database implementation
    try {
      const result = await this.db!.query(
        'SELECT * FROM game_meta WHERE game_id = $1 AND night = $2',
        [gameId, nightNumber]
      );
      
      return result.rows.map(row => ({
        gameId: row.game_id,
        userId: row.user_id,
        night: row.night,
        metaData: row.meta_data
      }));
    } catch (error) {
      console.error('Error fetching game meta:', error);
      throw error;
    }
  }

  async updatePlayers(gameId: number, players: Player[]): Promise<void> {
    if (this.useMock) {
      // Mock implementation for testing
      console.log(`Updating ${players.length} players for game ${gameId}`);
      return;
    }

    // Real database implementation
    try {
      const client = await this.db!.connect();
      
      try {
        await client.query('BEGIN');
        
        for (const player of players) {
          await client.query(
            `UPDATE players SET 
             status = $1, 
             is_dead = $2, 
             is_framed = $3, 
             charges_left = $4 
             WHERE id = $5 AND game_id = $6`,
            [
              player.status,
              player.status === 'dead',
              player.isFramed,
              player.chargesLeft,
              player.id,
              gameId
            ]
          );
        }
        
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('Error updating players:', error);
      throw error;
    }
  }

  async updateGameMeta(gameId: number, gameMeta: GameMeta[]): Promise<void> {
    if (this.useMock) {
      // Mock implementation for testing
      console.log(`Updating ${gameMeta.length} meta entries for game ${gameId}`);
      return;
    }

    // Real database implementation
    try {
      const client = await this.db!.connect();
      
      try {
        await client.query('BEGIN');
        
        for (const meta of gameMeta) {
          await client.query(
            `INSERT INTO game_meta (game_id, user_id, night, meta_data) 
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (game_id, user_id, night) 
             DO UPDATE SET meta_data = $4, updated_at = CURRENT_TIMESTAMP`,
            [gameId, meta.userId, meta.night, JSON.stringify(meta.metaData)]
          );
        }
        
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('Error updating game meta:', error);
      throw error;
    }
  }

  async getNightActions(gameId: number, nightNumber: number): Promise<any[]> {
    if (this.useMock) {
      // Mock implementation for testing
      return [
        {
          player_id: 1,
          action: 'Player2'
        },
        {
          player_id: 2,
          action: 'Player1'
        }
      ];
    }

    // Real database implementation
    try {
      const result = await this.db!.query(
        'SELECT player_id, action FROM night_action WHERE game_id = $1 AND night_number = $2',
        [gameId, nightNumber]
      );
      return result.rows;
    } catch (error) {
      console.error('Error fetching night actions:', error);
      throw error;
    }
  }

  async saveNightActions(gameId: number, nightNumber: number, actions: any[]): Promise<void> {
    if (this.useMock) {
      // Mock implementation for testing
      console.log(`Saving ${actions.length} night actions for game ${gameId}, night ${nightNumber}`);
      return;
    }

    // Real database implementation
    try {
      const client = await this.db!.connect();
      
      try {
        await client.query('BEGIN');
        
        for (const action of actions) {
          await client.query(
            `INSERT INTO night_action (game_id, player_id, action, night_number) 
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (game_id, player_id, night_number) 
             DO UPDATE SET action = $3`,
            [gameId, action.player_id, action.action, nightNumber]
          );
        }
        
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('Error saving night actions:', error);
      throw error;
    }
  }

  async getGameInfo(gameId: number): Promise<any> {
    if (this.useMock) {
      // Mock implementation for testing
      return {
        id: gameId,
        day_number: 1,
        status: 'active',
        day_phase: 'night'
      };
    }

    // Real database implementation
    try {
      const result = await this.db!.query(
        'SELECT id, day_number, status, day_phase FROM games WHERE id = $1',
        [gameId]
      );
      return result.rows[0] || null;
    } catch (error) {
      console.error('Error fetching game info:', error);
      throw error;
    }
  }

  async getDeadPlayers(gameId: number): Promise<Player[]> {
    if (this.useMock) {
      // Mock implementation for testing
      return [];
    }

    // Real database implementation
    try {
      const result = await this.db!.query(
        `SELECT p.*, r.name as role_name, r.team as role_team
         FROM players p 
         LEFT JOIN roles r ON p.role_id = r.id 
         WHERE p.game_id = $1 AND p.is_dead = true`,
        [gameId]
      );
      
      return result.rows.map(row => ({
        id: row.id,
        username: row.username,
        status: row.status,
        role: row.role_name,
        team: row.role_team,
        isWolf: row.is_wolf,
                 isFramed: row.is_framed,
         chargesLeft: row.charges_left,
         actionNotes: undefined
       }));
     } catch (error) {
       console.error('Error fetching dead players:', error);
       throw error;
     }
   }

   async getAlivePlayers(gameId: number): Promise<Player[]> {
     if (this.useMock) {
       // Mock implementation for testing
       return [
         {
           id: 1,
           username: 'Player1',
           status: 'alive',
           role: 'Seer',
           team: 'Town',
           isWolf: false,
           isFramed: false,
           chargesLeft: 3,
           actionNotes: 'Player2'
         },
         {
           id: 2,
           username: 'Player2',
           status: 'alive',
           role: 'Alpha Wolf',
           team: 'Wolf',
           isWolf: true,
           isFramed: false,
           chargesLeft: undefined,
           actionNotes: 'Player1'
         }
       ];
     }

     // Real database implementation
     try {
       const result = await this.db!.query(
         `SELECT p.*, r.name as role_name, r.team as role_team
          FROM players p 
          LEFT JOIN roles r ON p.role_id = r.id 
          WHERE p.game_id = $1 AND p.is_dead = false`,
         [gameId]
       );
       
       return result.rows.map(row => ({
         id: row.id,
         username: row.username,
         status: row.status,
         role: row.role_name,
         team: row.role_team,
         isWolf: row.is_wolf,
         isFramed: row.is_framed,
         chargesLeft: row.charges_left,
         actionNotes: undefined
       }));
     } catch (error) {
       console.error('Error fetching alive players:', error);
       throw error;
     }
   }

   async getPlayersByRole(gameId: number, roleName: string): Promise<Player[]> {
     if (this.useMock) {
       // Mock implementation for testing
       const allPlayers = await this.getPlayers(gameId);
       return allPlayers.filter(player => player.role === roleName);
     }

     // Real database implementation
     try {
       const result = await this.db!.query(
         `SELECT p.*, r.name as role_name, r.team as role_team
          FROM players p 
          JOIN roles r ON p.role_id = r.id 
          WHERE p.game_id = $1 AND r.name = $2`,
         [gameId, roleName]
       );
       
       return result.rows.map(row => ({
         id: row.id,
         username: row.username,
         status: row.status,
         role: row.role_name,
         team: row.role_team,
         isWolf: row.is_wolf,
         isFramed: row.is_framed,
         chargesLeft: row.charges_left,
         actionNotes: undefined
       }));
     } catch (error) {
       console.error('Error fetching players by role:', error);
       throw error;
     }
   }

  async updatePlayerStatus(gameId: number, playerId: number, status: string): Promise<void> {
    if (this.useMock) {
      // Mock implementation for testing
      console.log(`Updating player ${playerId} status to ${status} in game ${gameId}`);
      return;
    }

    // Real database implementation
    try {
      await this.db!.query(
        'UPDATE players SET status = $1, is_dead = $2 WHERE id = $3 AND game_id = $4',
        [status, status === 'dead', playerId, gameId]
      );
    } catch (error) {
      console.error('Error updating player status:', error);
      throw error;
    }
  }

  async updatePlayerCharges(gameId: number, playerId: number, charges: number): Promise<void> {
    if (this.useMock) {
      // Mock implementation for testing
      console.log(`Updating player ${playerId} charges to ${charges} in game ${gameId}`);
      return;
    }

    // Real database implementation
    try {
      await this.db!.query(
        'UPDATE players SET charges_left = $1 WHERE id = $2 AND game_id = $3',
        [charges, playerId, gameId]
      );
    } catch (error) {
      console.error('Error updating player charges:', error);
      throw error;
    }
  }

  async updatePlayerFramedStatus(gameId: number, playerId: number, isFramed: boolean, framedNight?: number): Promise<void> {
    if (this.useMock) {
      // Mock implementation for testing
      console.log(`Updating player ${playerId} framed status to ${isFramed} in game ${gameId}`);
      return;
    }

    // Real database implementation
    try {
      await this.db!.query(
        'UPDATE players SET is_framed = $1, framed_night = $2 WHERE id = $3 AND game_id = $4',
        [isFramed, framedNight, playerId, gameId]
      );
    } catch (error) {
      console.error('Error updating player framed status:', error);
      throw error;
    }
  }

  async saveGameMeta(gameId: number, userId: string, night: number, metaData: Record<string, any>): Promise<void> {
    if (this.useMock) {
      // Mock implementation for testing
      console.log(`Saving game meta for player ${userId} in game ${gameId}, night ${night}`);
      return;
    }

    // Real database implementation
    try {
      await this.db!.query(
        `INSERT INTO game_meta (game_id, user_id, night, meta_data) 
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (game_id, user_id, night) 
         DO UPDATE SET meta_data = $4, updated_at = CURRENT_TIMESTAMP`,
        [gameId, userId, night, JSON.stringify(metaData)]
      );
    } catch (error) {
      console.error('Error saving game meta:', error);
      throw error;
    }
  }

  async getGameMetaByUser(gameId: number, userId: string): Promise<GameMeta[]> {
    if (this.useMock) {
      // Mock implementation for testing
      return [
        {
          gameId,
          userId,
          night: 1,
          metaData: {}
        }
      ];
    }

    // Real database implementation
    try {
      const result = await this.db!.query(
        'SELECT * FROM game_meta WHERE game_id = $1 AND user_id = $2 ORDER BY night',
        [gameId, userId]
      );
      
      return result.rows.map(row => ({
        gameId: row.game_id,
        userId: row.user_id,
        night: row.night,
        metaData: row.meta_data
      }));
    } catch (error) {
      console.error('Error fetching game meta by user:', error);
      throw error;
    }
  }

  async close(): Promise<void> {
    if (this.db) {
      await this.db.end();
    }
    console.log('Closing database connection');
  }

  // Helper methods for role input requirements
  private getInputTypeForRole(roleName: string): 'none' | 'player_dropdown' | 'two_player_dropdown' | 'dead_player_dropdown' | 'role_dropdown' | 'alert_toggle' | 'arsonist_action' {
    const inputTypes: Record<string, 'none' | 'player_dropdown' | 'two_player_dropdown' | 'dead_player_dropdown' | 'role_dropdown' | 'alert_toggle' | 'arsonist_action'> = {
      'Seer': 'player_dropdown',
      'Doctor': 'player_dropdown',
      'Alpha Wolf': 'player_dropdown',
      'Veteran': 'alert_toggle',
      'Arsonist': 'arsonist_action',
      'Villager': 'none'
    };
    return inputTypes[roleName] || 'none';
  }

  private getInputDescriptionForRole(roleName: string): string {
    const descriptions: Record<string, string> = {
      'Seer': 'Select a player to investigate',
      'Doctor': 'Select a player to protect',
      'Alpha Wolf': 'Select a player to kill',
      'Veteran': 'Toggle alert on/off',
      'Arsonist': 'Choose douse or light'
    };
    return descriptions[roleName] || '';
  }

  private getInputValidationForRole(roleName: string): string {
    const validations: Record<string, string> = {
      'Seer': 'Target must be alive',
      'Doctor': 'Target must be alive',
      'Alpha Wolf': 'Target must be alive and targetable at home',
      'Veteran': 'Can only alert once per game',
      'Arsonist': 'Must have doused players to light'
    };
    return validations[roleName] || '';
  }
} 