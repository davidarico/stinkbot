// Database utility functions for PostgreSQL integration
import { Pool } from 'pg'

interface DatabaseConfig {
  connectionString: string
}

interface Game {
  id: number
  server_id: string
  game_number: number
  game_name?: string
  status: string
  day_phase: string
  day_number: number
  votes_to_hang: number
  category_id?: string
  is_skinned: boolean
  is_themed: boolean
  theme_name?: string
  created_at: Date
  updated_at: Date
}

interface Player {
  id: number
  game_id: number
  user_id: string
  username: string
  status: string
  role_id?: number
  skinned_role?: string
  is_wolf: boolean
  is_dead: boolean
  is_framed: boolean
  signed_up_at: Date
  charges?: number
  role?: string // This will be populated from the role join
}

interface Vote {
  id: number
  game_id: number
  voter_user_id: string
  target_user_id: string
  day_number: number
  voted_at: Date
}

interface GameRole {
  game_id: number
  role_id: number
  role_count: number
  custom_name?: string
}

interface Role {
  id: number
  name: string
  team: string
  description: string
  targets?: string
  moves: boolean
  standard_results_flavor?: string
  immunities?: string
  special_properties?: string
  framer_interaction?: string
  in_wolf_chat: boolean
}

// PostgreSQL database service
export class DatabaseService {
  private pool: Pool

  constructor(connectionString: string) {
    this.pool = new Pool({
      connectionString,
      ssl: connectionString.includes('supabase') ? { rejectUnauthorized: false } : false,
    })
  }

  async getGame(gameId: string): Promise<Game | null> {
    try {
      const result = await this.pool.query(
        'SELECT * FROM games WHERE id = $1',
        [parseInt(gameId)]
      )
      return result.rows[0] || null
    } catch (error) {
      console.error('Error fetching game:', error)
      throw error
    }
  }

  async getPlayers(gameId: string): Promise<Player[]> {
    try {
      const result = await this.pool.query(
        `SELECT p.*, r.name as role_name, r.team as role_team
         FROM players p 
         LEFT JOIN roles r ON p.role_id = r.id 
         WHERE p.game_id = $1 
         ORDER BY p.signed_up_at`,
        [parseInt(gameId)]
      )
      return result.rows.map(row => ({
        ...row,
        role: row.role_name, // Use role_name from join
        charges: row.charges_left // Map charges_left to charges
      }))
    } catch (error) {
      console.error('Error fetching players:', error)
      throw error
    }
  }

  async getRoles() {
    try {
      const client = await this.pool.connect()
      
      try {
        const result = await client.query(`
          SELECT 
            id,
            name,
            team as alignment,
            description,
            targets,
            moves,
            standard_results_flavor,
            immunities,
            special_properties,
            framer_interaction,
            in_wolf_chat,
            has_charges,
            default_charges,
            is_spotlight
          FROM roles 
          ORDER BY name
        `)
        
        return result.rows.map(role => ({
          id: role.id,
          name: role.name,
          alignment: role.alignment,
          description: role.description,
          targets: role.targets,
          moves: role.moves,
          standardResultsFlavor: role.standard_results_flavor,
          immunities: role.immunities,
          specialProperties: role.special_properties,
          framerInteraction: role.framer_interaction,
          hasInfoFunction: role.targets === 'Players' && role.moves,
          hasCharges: role.has_charges,
          defaultCharges: role.default_charges,
          inWolfChat: role.in_wolf_chat,
          isSpotlight: role.is_spotlight
        }))
      } finally {
        client.release()
      }
    } catch (error) {
      console.error('Error fetching roles:', error)
      // Return fallback static data if database fails
      return [
        { id: 1, name: "Villager", alignment: "town", description: "A regular townsperson with no special abilities." },
        {
          id: 2,
          name: "Seer",
          alignment: "town",
          description: "Can investigate one player each night.",
          hasInfoFunction: true,
        },
        { id: 3, name: "Doctor", alignment: "town", description: "Can protect one player each night." },
        { id: 4, name: "Werewolf", alignment: "wolf", description: "Kills townspeople at night." },
        { id: 5, name: "Alpha Wolf", alignment: "wolf", description: "Leader of the wolf pack." },
      ]
    }
  }

  async assignRoles(gameId: string, assignments: Array<{playerId: number, roleId: number, isWolf: boolean, skinnedRole?: string}>) {
    try {
      const client = await this.pool.connect()
      
      try {
        await client.query('BEGIN')
        
        for (const assignment of assignments) {
          await client.query(
            'UPDATE players SET role_id = $1, is_wolf = $2, skinned_role = $3 WHERE id = $4 AND game_id = $5',
            [assignment.roleId, assignment.isWolf, assignment.skinnedRole || null, assignment.playerId, parseInt(gameId)]
          )
        }
        
        await client.query('COMMIT')
        return { success: true }
      } catch (error) {
        await client.query('ROLLBACK')
        throw error
      } finally {
        client.release()
      }
    } catch (error) {
      console.error('Error assigning roles:', error)
      throw error
    }
  }

  async updatePlayerStatus(playerId: number, status: string) {
    try {
      const result = await this.pool.query(
        'UPDATE players SET status = $1 WHERE id = $2 RETURNING *',
        [status, playerId]
      )
      return { success: true, player: result.rows[0] }
    } catch (error) {
      console.error('Error updating player status:', error)
      throw error
    }
  }

  async updatePlayerCharges(playerId: number, charges: number) {
    try {
      const result = await this.pool.query(
        'UPDATE players SET charges_left = $1 WHERE id = $2 RETURNING *',
        [charges, playerId]
      )
      return { success: true, player: result.rows[0] }
    } catch (error) {
      console.error('Error updating player charges:', error)
      throw error
    }
  }

  async getVotes(gameId: string, dayNumber: number): Promise<Vote[]> {
    try {
      const result = await this.pool.query(
        `SELECT v.*, p1.username as voter_username, p2.username as target_username 
         FROM votes v
         JOIN players p1 ON v.voter_user_id = p1.user_id AND p1.game_id = v.game_id
         JOIN players p2 ON v.target_user_id = p2.user_id AND p2.game_id = v.game_id
         WHERE v.game_id = $1 AND v.day_number = $2`,
        [parseInt(gameId), dayNumber]
      )
      return result.rows
    } catch (error) {
      console.error('Error fetching votes:', error)
      throw error
    }
  }

  async addVote(gameId: string, voterUserId: string, targetUserId: string, dayNumber: number) {
    try {
      // First, remove any existing vote from this voter for this day
      await this.pool.query(
        'DELETE FROM votes WHERE game_id = $1 AND voter_user_id = $2 AND day_number = $3',
        [parseInt(gameId), voterUserId, dayNumber]
      )
      
      // Then add the new vote
      const result = await this.pool.query(
        'INSERT INTO votes (game_id, voter_user_id, target_user_id, day_number) VALUES ($1, $2, $3, $4) RETURNING *',
        [parseInt(gameId), voterUserId, targetUserId, dayNumber]
      )
      
      return { success: true, vote: result.rows[0] }
    } catch (error) {
      console.error('Error adding vote:', error)
      throw error
    }
  }

  async verifyGamePassword(gameId: string, password: string): Promise<boolean> {
    try {
      const result = await this.pool.query(
        'SELECT category_id FROM games WHERE id = $1',
        [parseInt(gameId)]
      )
      
      if (result.rows.length === 0) {
        return false
      }
      
      return result.rows[0].category_id === password
    } catch (error) {
      console.error('Error verifying game password:', error)
      return false
    }
  }

  async getGameRoles(gameId: string): Promise<GameRole[]> {
    try {
      const result = await this.pool.query(
        `SELECT gr.*, r.name as role_name, r.team as role_team, r.has_charges, r.default_charges, r.in_wolf_chat
         FROM game_role gr 
         JOIN roles r ON gr.role_id = r.id 
         WHERE gr.game_id = $1`,
        [parseInt(gameId)]
      )
      return result.rows
    } catch (error) {
      console.error('Error fetching game roles:', error)
      throw error
    }
  }

  async saveGameRoles(gameId: string, gameRoles: Array<{roleId: number, roleCount: number, customName?: string, charges?: number}>) {
    try {
      const client = await this.pool.connect()
      
      try {
        await client.query('BEGIN')
        
        // Clear existing game roles
        await client.query('DELETE FROM game_role WHERE game_id = $1', [parseInt(gameId)])
        
        // Insert new game roles
        for (const gameRole of gameRoles) {
          // Insert or update since we may have constraint issues
          await client.query(
            `INSERT INTO game_role (game_id, role_id, role_count, custom_name, charges) 
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (game_id, role_id) DO UPDATE SET 
             role_count = EXCLUDED.role_count,
             custom_name = EXCLUDED.custom_name,
             charges = EXCLUDED.charges`,
            [parseInt(gameId), gameRole.roleId, gameRole.roleCount, gameRole.customName || null, gameRole.charges || null]
          )
        }
        
        await client.query('COMMIT')
        return { success: true }
      } catch (error) {
        await client.query('ROLLBACK')
        throw error
      } finally {
        client.release()
      }
    } catch (error) {
      console.error('Error saving game roles:', error)
      // If constraint error, try individual inserts
      return this.saveGameRolesIndividually(gameId, gameRoles)
    }
  }

  private async saveGameRolesIndividually(gameId: string, gameRoles: Array<{roleId: number, roleCount: number, customName?: string, charges?: number}>) {
    try {
      const client = await this.pool.connect()
      
      try {
        await client.query('BEGIN')
        
        // Clear existing game roles
        await client.query('DELETE FROM game_role WHERE game_id = $1', [parseInt(gameId)])
        
        // Insert new game roles one by one
        for (const gameRole of gameRoles) {
          try {
            await client.query(
              'INSERT INTO game_role (game_id, role_id, role_count, custom_name, charges) VALUES ($1, $2, $3, $4, $5)',
              [parseInt(gameId), gameRole.roleId, gameRole.roleCount, gameRole.customName || null, gameRole.charges || null]
            )
          } catch (insertError) {
            console.warn('Failed to insert game role:', insertError)
            // Continue with other roles
          }
        }
        
        await client.query('COMMIT')
        return { success: true }
      } catch (error) {
        await client.query('ROLLBACK')
        throw error
      } finally {
        client.release()
      }
    } catch (error) {
      console.error('Error saving game roles individually:', error)
      throw error
    }
  }

  async updateGameTheme(gameId: string, isThemed: boolean, isSkinned: boolean, themeName?: string) {
    try {
      const result = await this.pool.query(
        'UPDATE games SET is_themed = $1, is_skinned = $2, theme_name = $3 WHERE id = $4 RETURNING *',
        [isThemed, isSkinned, themeName || null, parseInt(gameId)]
      )
      return { success: true, game: result.rows[0] }
    } catch (error) {
      console.error('Error updating game theme:', error)
      throw error
    }
  }

  // Cleanup method to close the pool
  async close() {
    await this.pool.end()
  }
}

// Export a singleton instance
export const db = new DatabaseService(process.env.DATABASE_URL || "")
