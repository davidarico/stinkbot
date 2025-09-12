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
  day_message?: string
  night_message?: string
  wolf_day_message?: string
  wolf_night_message?: string
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
  framed_night?: number
  charges_left?: number
  win_by_number?: number
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
  charges?: number
  win_by_number?: number
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
            has_win_by_number,
            default_win_by_number,
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
          hasWinByNumber: role.has_win_by_number,
          defaultWinByNumber: role.default_win_by_number,
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
        
        // First, get the game roles to get charges and win_by_number values
        const gameRoles = await this.getGameRoles(gameId)
        const gameRoleMap = new Map(gameRoles.map(gr => [gr.role_id, gr]))
        
        for (const assignment of assignments) {
          // Update basic role assignment
          await client.query(
            'UPDATE players SET role_id = $1, is_wolf = $2, skinned_role = $3 WHERE id = $4 AND game_id = $5',
            [assignment.roleId, assignment.isWolf, assignment.skinnedRole || null, assignment.playerId, parseInt(gameId)]
          )
          
          // Set charges and win_by_number from game_role table
          const gameRole = gameRoleMap.get(assignment.roleId)
          if (gameRole) {
            // Set charges if the role has charges, otherwise clear them
            if (gameRole.charges !== undefined && gameRole.charges > 0) {
              await client.query(
                'UPDATE players SET charges_left = $1 WHERE id = $2 AND game_id = $3',
                [gameRole.charges, assignment.playerId, parseInt(gameId)]
              )
            } else {
              // Clear charges for roles that don't have them
              await client.query(
                'UPDATE players SET charges_left = NULL WHERE id = $1 AND game_id = $2',
                [assignment.playerId, parseInt(gameId)]
              )
            }
            
            // Set win_by_number if the role has win_by_number, otherwise clear it
            if (gameRole.win_by_number !== undefined && gameRole.win_by_number > 0) {
              await client.query(
                'UPDATE players SET win_by_number = $1 WHERE id = $2 AND game_id = $3',
                [gameRole.win_by_number, assignment.playerId, parseInt(gameId)]
              )
            } else {
              // Clear win_by_number for roles that don't have it
              await client.query(
                'UPDATE players SET win_by_number = NULL WHERE id = $1 AND game_id = $2',
                [assignment.playerId, parseInt(gameId)]
              )
            }
          } else {
            // If no game role found, clear both charges and win_by_number
            await client.query(
              'UPDATE players SET charges_left = NULL, win_by_number = NULL WHERE id = $1 AND game_id = $2',
              [assignment.playerId, parseInt(gameId)]
            )
          }
        }
        
        // Check for couple roles and create couple chat if needed
        await this.handleCoupleChat(client, gameId)
        
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

  async updatePlayerWinByNumber(playerId: number, winByNumber: number) {
    try {
      const result = await this.pool.query(
        'UPDATE players SET win_by_number = $1 WHERE id = $2 RETURNING *',
        [winByNumber, playerId]
      )
      return { success: true, player: result.rows[0] }
    } catch (error) {
      console.error('Error updating player win_by_number:', error)
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
        `SELECT gr.*, r.name as role_name, r.team as role_team, r.has_charges, r.default_charges, r.has_win_by_number, r.default_win_by_number, r.in_wolf_chat
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

  async saveGameRoles(gameId: string, gameRoles: Array<{roleId: number, roleCount: number, customName?: string, charges?: number, winByNumber?: number}>) {
    try {
      const client = await this.pool.connect()
      
      try {
        await client.query('BEGIN')
        
        // Verify game exists
        const gameCheck = await client.query('SELECT id FROM games WHERE id = $1', [parseInt(gameId)])
        if (gameCheck.rows.length === 0) {
          throw new Error(`Game with ID ${gameId} does not exist`)
        }
        
        // Verify all roles exist
        for (const gameRole of gameRoles) {
          const roleCheck = await client.query('SELECT id FROM roles WHERE id = $1', [gameRole.roleId])
          if (roleCheck.rows.length === 0) {
            throw new Error(`Role with ID ${gameRole.roleId} does not exist`)
          }
        }
        
        // Clear existing game roles
        await client.query('DELETE FROM game_role WHERE game_id = $1', [parseInt(gameId)])
        
        // Insert new game roles
        for (const gameRole of gameRoles) {
          try {
            await client.query(
              'INSERT INTO game_role (game_id, role_id, role_count, custom_name, charges, win_by_number) VALUES ($1, $2, $3, $4, $5, $6)',
              [parseInt(gameId), gameRole.roleId, gameRole.roleCount, gameRole.customName || null, gameRole.charges ?? 0, gameRole.winByNumber ?? 0]
            )
          } catch (insertError) {
            console.error('Failed to insert game role:', insertError)
            throw insertError
          }
        }
        
        await client.query('COMMIT')
        return { success: true }
      } catch (error) {
        console.error('Transaction failed, rolling back:', error)
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

  private async saveGameRolesIndividually(gameId: string, gameRoles: Array<{roleId: number, roleCount: number, customName?: string, charges?: number, winByNumber?: number}>) {
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
              'INSERT INTO game_role (game_id, role_id, role_count, custom_name, charges, win_by_number) VALUES ($1, $2, $3, $4, $5, $6)',
              [parseInt(gameId), gameRole.roleId, gameRole.roleCount, gameRole.customName || null, gameRole.charges ?? 0, gameRole.winByNumber ?? 0]
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

  async updateGameSettings(gameId: string, settings: {
    dayMessage?: string
    nightMessage?: string
    wolfDayMessage?: string
    wolfNightMessage?: string
    votesToHang?: number
    gameChannels?: Array<{
      id: number
      dayMessage?: string
      nightMessage?: string
      open_at_dawn?: boolean
      open_at_dusk?: boolean
    }>
  }) {
    try {
      const client = await this.pool.connect()
      
      try {
        await client.query('BEGIN')
        
        // Update main game settings
        if (settings.dayMessage !== undefined || settings.nightMessage !== undefined || 
            settings.wolfDayMessage !== undefined || settings.wolfNightMessage !== undefined ||
            settings.votesToHang !== undefined) {
          const updateFields = []
          const values = []
          let paramCount = 1
          
          if (settings.dayMessage !== undefined) {
            updateFields.push(`day_message = $${paramCount}`)
            values.push(settings.dayMessage)
            paramCount++
          }
          if (settings.nightMessage !== undefined) {
            updateFields.push(`night_message = $${paramCount}`)
            values.push(settings.nightMessage)
            paramCount++
          }
          if (settings.wolfDayMessage !== undefined) {
            updateFields.push(`wolf_day_message = $${paramCount}`)
            values.push(settings.wolfDayMessage)
            paramCount++
          }
          if (settings.wolfNightMessage !== undefined) {
            updateFields.push(`wolf_night_message = $${paramCount}`)
            values.push(settings.wolfNightMessage)
            paramCount++
          }
          if (settings.votesToHang !== undefined) {
            updateFields.push(`votes_to_hang = $${paramCount}`)
            values.push(settings.votesToHang)
            paramCount++
          }
          
          values.push(parseInt(gameId))
          await client.query(
            `UPDATE games SET ${updateFields.join(', ')} WHERE id = $${paramCount}`,
            values
          )
        }
        
        // Update game channel settings
        if (settings.gameChannels) {
          for (const channel of settings.gameChannels) {
            const updateFields = []
            const values = []
            let paramCount = 1
            
            if (channel.dayMessage !== undefined) {
              updateFields.push(`day_message = $${paramCount}`)
              values.push(channel.dayMessage)
              paramCount++
            }
            if (channel.nightMessage !== undefined) {
              updateFields.push(`night_message = $${paramCount}`)
              values.push(channel.nightMessage)
              paramCount++
            }
            if (channel.open_at_dawn !== undefined) {
              updateFields.push(`open_at_dawn = $${paramCount}`)
              values.push(channel.open_at_dawn)
              paramCount++
            }
            if (channel.open_at_dusk !== undefined) {
              updateFields.push(`open_at_dusk = $${paramCount}`)
              values.push(channel.open_at_dusk)
              paramCount++
            }
            
            if (updateFields.length > 0) {
              values.push(channel.id)
              await client.query(
                `UPDATE game_channels SET ${updateFields.join(', ')} WHERE id = $${paramCount}`,
                values
              )
            }
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
      console.error('Error updating game settings:', error)
      throw error
    }
  }

  async getGameChannels(gameId: string) {
    try {
      const result = await this.pool.query(
        'SELECT * FROM game_channels WHERE game_id = $1 ORDER BY created_at',
        [parseInt(gameId)]
      )
      return result.rows
    } catch (error) {
      console.error('Error fetching game channels:', error)
      throw error
    }
  }

  async addGameChannel(gameId: string, channelData: {
    channelName: string
    channelId?: string
    dayMessage?: string
    nightMessage?: string
    openAtDawn: boolean
    openAtDusk: boolean
    isCoupleChat?: boolean
    invitedUsers?: string[]
  }) {
    try {
      const result = await this.pool.query(
        `INSERT INTO game_channels (game_id, channel_id, channel_name, day_message, night_message, open_at_dawn, open_at_dusk, is_couple_chat, invited_users) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
        [
          parseInt(gameId),
          channelData.channelId || null,
          channelData.channelName,
          channelData.dayMessage || null,
          channelData.nightMessage || null,
          channelData.openAtDawn,
          channelData.openAtDusk,
          channelData.isCoupleChat || false,
          channelData.invitedUsers ? JSON.stringify(channelData.invitedUsers) : null
        ]
      )
      return { success: true, channel: result.rows[0] }
    } catch (error) {
      console.error('Error adding game channel:', error)
      throw error
    }
  }

  async addInvitedUserToChannel(gameId: string, channelId: number, userId: string) {
    try {
      // First get the current invited_users array
      const currentResult = await this.pool.query(
        'SELECT invited_users FROM game_channels WHERE id = $1 AND game_id = $2',
        [channelId, parseInt(gameId)]
      )
      
      if (currentResult.rows.length === 0) {
        throw new Error('Channel not found')
      }

      const currentInvitedUsers = currentResult.rows[0].invited_users || []
      
      // Check if user is already invited
      if (currentInvitedUsers.includes(userId)) {
        return { success: false, message: 'User already invited' }
      }

      // Add the user to the array
      const updatedInvitedUsers = [...currentInvitedUsers, userId]
      
      const result = await this.pool.query(
        'UPDATE game_channels SET invited_users = $1 WHERE id = $2 AND game_id = $3 RETURNING *',
        [JSON.stringify(updatedInvitedUsers), channelId, parseInt(gameId)]
      )
      
      return { success: true, channel: result.rows[0] }
    } catch (error) {
      console.error('Error adding invited user to channel:', error)
      throw error
    }
  }

  async removeInvitedUserFromChannel(gameId: string, channelId: number, userId: string) {
    try {
      // First get the current invited_users array
      const currentResult = await this.pool.query(
        'SELECT invited_users FROM game_channels WHERE id = $1 AND game_id = $2',
        [channelId, parseInt(gameId)]
      )
      
      if (currentResult.rows.length === 0) {
        throw new Error('Channel not found')
      }

      const currentInvitedUsers = currentResult.rows[0].invited_users || []
      
      // Remove the user from the array
      const updatedInvitedUsers = currentInvitedUsers.filter((user: string) => user !== userId)
      
      const result = await this.pool.query(
        'UPDATE game_channels SET invited_users = $1 WHERE id = $2 AND game_id = $3 RETURNING *',
        [JSON.stringify(updatedInvitedUsers), channelId, parseInt(gameId)]
      )
      
      return { success: true, channel: result.rows[0] }
    } catch (error) {
      console.error('Error removing invited user from channel:', error)
      throw error
    }
  }

  async deleteGameChannel(gameId: string, channelId: number) {
    try {
      const result = await this.pool.query(
        'DELETE FROM game_channels WHERE id = $1 AND game_id = $2 RETURNING *',
        [channelId, parseInt(gameId)]
      )
      
      if (result.rows.length === 0) {
        return { success: false, message: 'Channel not found' }
      }
      
      return { success: true, channel: result.rows[0] }
    } catch (error) {
      console.error('Error deleting game channel:', error)
      throw error
    }
  }

  async getNightActions(gameId: string, nightNumber: number) {
    try {
      console.log('Database: Fetching night actions for game', gameId, 'night', nightNumber)
      const result = await this.pool.query(
        'SELECT player_id, action FROM night_action WHERE game_id = $1 AND night_number = $2',
        [parseInt(gameId), nightNumber]
      )
      console.log('Database: Found night actions:', result.rows)
      return result.rows
    } catch (error) {
      console.error('Error fetching night actions:', error)
      throw error
    }
  }

  async saveNightAction(gameId: string, playerId: number, action: string, nightNumber: number) {
    try {
      const client = await this.pool.connect()
      
      try {
        await client.query('BEGIN')
        
        // First, delete any existing action for this player and night
        await client.query(
          'DELETE FROM night_action WHERE game_id = $1 AND player_id = $2 AND night_number = $3',
          [parseInt(gameId), playerId, nightNumber]
        )
        
        // Then insert the new action
        await client.query(
          'INSERT INTO night_action (game_id, player_id, action, night_number) VALUES ($1, $2, $3, $4)',
          [parseInt(gameId), playerId, action, nightNumber]
        )
        
        await client.query('COMMIT')
        return { success: true }
      } catch (error) {
        await client.query('ROLLBACK')
        throw error
      } finally {
        client.release()
      }
    } catch (error) {
      console.error('Error saving night action:', error)
      throw error
    }
  }

  async getServerConfig(serverId: string) {
    try {
      const result = await this.pool.query(
        'SELECT * FROM server_configs WHERE server_id = $1',
        [serverId]
      )
      return result.rows[0] || null
    } catch (error) {
      console.error('Error fetching server config:', error)
      throw error
    }
  }

  async getAdminSetting(settingKey: string): Promise<string | null> {
    try {
      const result = await this.pool.query(
        'SELECT setting_value FROM admin_settings WHERE setting_key = $1',
        [settingKey]
      )
      return result.rows.length > 0 ? result.rows[0].setting_value : null
    } catch (error) {
      console.error('Error fetching admin setting:', error)

      throw error
    }
  }

  async getServerUsersByUserIds(userIds: string[]) {
    try {
      if (userIds.length === 0) return []
      
      const placeholders = userIds.map((_, index) => `$${index + 1}`).join(',')
      const result = await this.pool.query(
        `SELECT user_id, display_name, profile_picture_link FROM server_users WHERE user_id = ANY($1)`,
        [userIds]
      )
      return result.rows
    } catch (error) {
      console.error('Error fetching server users by user IDs:', error)
      throw error
    }
  }

  async updateAdminSetting(settingKey: string, settingValue: string) {
    try {
      await this.pool.query(
        'INSERT INTO admin_settings (setting_key, setting_value) VALUES ($1, $2) ON CONFLICT (setting_key) DO UPDATE SET setting_value = $2, updated_at = CURRENT_TIMESTAMP',
        [settingKey, settingValue]
      )
      return { success: true }
    } catch (error) {
      console.error('Error updating admin setting:', error)
      throw error
    }
  }

  async getServerUsersByDisplayName(displayName: string) {
    try {
      const result = await this.pool.query(
        `SELECT user_id, display_name, profile_picture_link FROM server_users WHERE display_name = $1`,
        [displayName]
      )
      return result.rows
    } catch (error) {
      console.error('Error fetching server users by display name:', error)
      throw error
    }
  }

  async getCoupleChat(gameId: string) {
    try {
      const result = await this.pool.query(
        'SELECT * FROM game_channels WHERE game_id = $1 AND is_couple_chat = true LIMIT 1',
        [parseInt(gameId)]
      )
      return result.rows[0] || null
    } catch (error) {
      console.error('Error fetching couple chat:', error)
      throw error
    }
  }

  async getCouplePlayerUserIds(gameId: string): Promise<string[]> {
    try {
      const result = await this.pool.query(
        `SELECT p.user_id 
         FROM players p 
         JOIN roles r ON p.role_id = r.id 
         WHERE p.game_id = $1 AND r.name = 'Couple'`,
        [parseInt(gameId)]
      )
      return result.rows.map(row => row.user_id)
    } catch (error) {
      console.error('Error fetching couple player user IDs:', error)
      throw error
    }
  }

  private async handleCoupleChat(client: any, gameId: string) {
    try {
      // Get couple players
      const coupleResult = await client.query(
        `SELECT p.user_id 
         FROM players p 
         JOIN roles r ON p.role_id = r.id 
         WHERE p.game_id = $1 AND r.name = 'Couple'`,
        [parseInt(gameId)]
      )
      
      const coupleUserIds = coupleResult.rows.map((row: any) => row.user_id)
      
      // Check if couple chat already exists
      const existingCoupleChat = await client.query(
        'SELECT id FROM game_channels WHERE game_id = $1 AND is_couple_chat = true',
        [parseInt(gameId)]
      )
      
      if (coupleUserIds.length !== 2) {
        // No couples in the game - delete existing couple chat if it exists
        if (existingCoupleChat.rows.length > 0) {
          await client.query(
            'DELETE FROM game_channels WHERE game_id = $1 AND is_couple_chat = true',
            [parseInt(gameId)]
          )
        }
      } else if (coupleUserIds.length === 2) {
        // Exactly 2 couples - create or update couple chat
        if (existingCoupleChat.rows.length > 0) {
          // Update existing couple chat with new invited users
          await client.query(
            'UPDATE game_channels SET invited_users = $1 WHERE game_id = $2 AND is_couple_chat = true',
            [JSON.stringify(coupleUserIds), parseInt(gameId)]
          )
        } else {
          // Create new couple chat
          // Get game and server config info to construct the channel name
          const gameResult = await client.query(
            'SELECT game_number, server_id FROM games WHERE id = $1',
            [parseInt(gameId)]
          )
          
          if (gameResult.rows.length > 0) {
            const game = gameResult.rows[0]
            const serverConfigResult = await client.query(
              'SELECT game_prefix FROM server_configs WHERE server_id = $1',
              [game.server_id]
            )
            
            const serverConfig = serverConfigResult.rows[0]
            const channelName = `${serverConfig.game_prefix}${game.game_number}-couple-chat`
            
            // Create couple chat channel
            await client.query(
              `INSERT INTO game_channels (game_id, channel_name, day_message, night_message, open_at_dawn, open_at_dusk, is_couple_chat, invited_users) 
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
              [
                parseInt(gameId),
                channelName,
                'Back to the mines yall go.', // Day message
                'Have some nice pillow talk you two.', // Night message
                false, // Don't open at dawn (day)
                true,  // Open at dusk (night)
                true,  // This is a couple chat
                JSON.stringify(coupleUserIds)
              ]
            )
          }
        }
      }
      // For any other number of couples (1, 3+), we don't create/update/delete the couple chat
      // The frontend validation messages will handle those cases
    } catch (error) {
      console.error('Error handling couple chat:', error)
      // Don't throw - this shouldn't break role assignment
    }
  }

  // Kanban task methods
  async getKanbanTasks() {
    try {
      const result = await this.pool.query(
        'SELECT * FROM kanban_tasks ORDER BY status, position, created_at'
      )
      return result.rows
    } catch (error) {
      console.error('Error fetching kanban tasks:', error)
      throw error
    }
  }

  async createKanbanTask(title: string, description?: string, status: string = 'todo') {
    try {
      // Get the next position for this status
      const positionResult = await this.pool.query(
        'SELECT COALESCE(MAX(position), 0) + 1 as next_position FROM kanban_tasks WHERE status = $1',
        [status]
      )
      const nextPosition = positionResult.rows[0].next_position

      const result = await this.pool.query(
        'INSERT INTO kanban_tasks (title, description, status, position) VALUES ($1, $2, $3, $4) RETURNING *',
        [title, description || null, status, nextPosition]
      )
      return { success: true, task: result.rows[0] }
    } catch (error) {
      console.error('Error creating kanban task:', error)
      throw error
    }
  }

  async updateKanbanTask(id: number, updates: {
    title?: string
    description?: string
    status?: string
    position?: number
  }) {
    try {
      const updateFields = []
      const values = []
      let paramCount = 1

      if (updates.title !== undefined) {
        updateFields.push(`title = $${paramCount}`)
        values.push(updates.title)
        paramCount++
      }
      if (updates.description !== undefined) {
        updateFields.push(`description = $${paramCount}`)
        values.push(updates.description)
        paramCount++
      }
      if (updates.status !== undefined) {
        updateFields.push(`status = $${paramCount}`)
        values.push(updates.status)
        paramCount++
      }
      if (updates.position !== undefined) {
        updateFields.push(`position = $${paramCount}`)
        values.push(updates.position)
        paramCount++
      }

      if (updateFields.length === 0) {
        return { success: false, message: 'No updates provided' }
      }

      updateFields.push(`updated_at = CURRENT_TIMESTAMP`)
      values.push(id)

      const result = await this.pool.query(
        `UPDATE kanban_tasks SET ${updateFields.join(', ')} WHERE id = $${paramCount} RETURNING *`,
        values
      )

      if (result.rows.length === 0) {
        return { success: false, message: 'Task not found' }
      }

      return { success: true, task: result.rows[0] }
    } catch (error) {
      console.error('Error updating kanban task:', error)
      throw error
    }
  }

  async deleteKanbanTask(id: number) {
    try {
      const result = await this.pool.query(
        'DELETE FROM kanban_tasks WHERE id = $1 RETURNING *',
        [id]
      )

      if (result.rows.length === 0) {
        return { success: false, message: 'Task not found' }
      }

      return { success: true, task: result.rows[0] }
    } catch (error) {
      console.error('Error deleting kanban task:', error)
      throw error
    }
  }

  // Feedback methods
  async getFeedback() {
    try {
      const result = await this.pool.query(
        'SELECT * FROM feedback ORDER BY created_at ASC'
      )
      return result.rows
    } catch (error) {
      console.error('Error fetching feedback:', error)
      throw error
    }
  }

  async createFeedback(userId: string, displayName: string, feedbackText: string, serverId: string) {
    try {
      const result = await this.pool.query(
        'INSERT INTO feedback (user_id, display_name, feedback_text, server_id) VALUES ($1, $2, $3, $4) RETURNING *',
        [userId, displayName, feedbackText, serverId]
      )
      return { success: true, feedback: result.rows[0] }
    } catch (error) {
      console.error('Error creating feedback:', error)
      throw error
    }
  }

  async deleteFeedback(id: number) {
    try {
      const result = await this.pool.query(
        'DELETE FROM feedback WHERE id = $1 RETURNING *',
        [id]
      )

      if (result.rows.length === 0) {
        return { success: false, message: 'Feedback not found' }
      }

      return { success: true, feedback: result.rows[0] }
    } catch (error) {
      console.error('Error deleting feedback:', error)
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
