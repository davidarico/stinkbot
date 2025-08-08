use anyhow::Result;
use serenity::prelude::*;
use serenity::model::prelude::*;
use crate::werewolf::WerewolfBot;
use crate::cache::{GameCache, ServerConfig};
use crate::DbPoolKey;
use lazy_static::lazy_static;
use regex::Regex;
use chrono::{DateTime, Utc};

lazy_static! {
    static ref COMMAND_REGEX: Regex = Regex::new(r"^(?i)wolf\.(\w+)(?:\s+(.*))?$").unwrap();
}

pub struct MessageHandler {
    pub cache: GameCache,
}

impl MessageHandler {
    pub fn new() -> Self {
        Self {
            cache: GameCache::new(),
        }
    }

    pub async fn handle_message(&self, ctx: &Context, msg: &Message) -> Result<()> {
        if msg.author.bot {
            return Ok(());
        }

        let guild_id = match msg.guild_id {
            Some(id) => id.get(),
            None => return Ok(()), // DMs not supported yet
        };

        // Fast regex-based command parsing
        if let Some(captures) = COMMAND_REGEX.captures(&msg.content) {
            let command = captures.get(1).unwrap().as_str().to_lowercase();
            let args = captures.get(2).map(|m| m.as_str().trim()).unwrap_or("");

            let data = ctx.data.read().await;
            let pool = data.get::<DbPoolKey>().unwrap();
            let bot = WerewolfBot::new(pool.clone());

            match command.as_str() {
                "ping" => self.handle_ping(ctx, msg).await?,
                "help" => self.handle_help(ctx, msg).await?,
                
                // Admin commands
                "setup" => {
                    if self.check_admin_perms(ctx, msg).await? {
                        self.handle_setup(ctx, msg, args, &bot).await?;
                    } else {
                        self.send_no_permission_error(ctx, msg).await?;
                    }
                }
                "create" => {
                    if self.check_admin_perms(ctx, msg).await? {
                        self.handle_create(ctx, msg, &bot).await?;
                    } else {
                        self.send_no_permission_error(ctx, msg).await?;
                    }
                }
                "start" | "begin" => {
                    if self.check_admin_perms(ctx, msg).await? {
                        self.handle_start(ctx, msg, &bot).await?;
                    } else {
                        self.send_no_permission_error(ctx, msg).await?;
                    }
                }
                "end" => {
                    if self.check_admin_perms(ctx, msg).await? {
                        self.handle_end(ctx, msg, &bot).await?;
                    } else {
                        self.send_no_permission_error(ctx, msg).await?;
                    }
                }
                
                // Game flow commands
                "next" => {
                    if self.check_admin_perms(ctx, msg).await? {
                        self.handle_next(ctx, msg, &bot).await?;
                    } else {
                        self.send_no_permission_error(ctx, msg).await?;
                    }
                }
                "refresh" => self.handle_refresh(ctx, msg, &bot).await?,
                
                // Voting commands
                "create_vote" => {
                    if self.check_admin_perms(ctx, msg).await? {
                        self.handle_create_vote(ctx, msg, &bot).await?;
                    } else {
                        self.send_no_permission_error(ctx, msg).await?;
                    }
                }
                "get_votes" => self.handle_get_votes(ctx, msg, &bot).await?,
                
                // Player commands
                "in" | "join" => self.handle_join(ctx, msg, &bot).await?,
                "out" | "leave" => self.handle_leave(ctx, msg, &bot).await?,
                "vote" => self.handle_vote(ctx, msg, args, &bot).await?,
                "retract" => self.handle_retract(ctx, msg, &bot).await?,
                "alive" => self.handle_alive(ctx, msg, &bot).await?,
                "inlist" => self.handle_inlist(ctx, msg, &bot).await?,
                
                // Server/Channel management commands
                "server_roles" => {
                    if self.check_admin_perms(ctx, msg).await? {
                        self.handle_server_roles(ctx, msg, &bot).await?;
                    } else {
                        self.send_no_permission_error(ctx, msg).await?;
                    }
                }
                "add_channel" => {
                    if self.check_admin_perms(ctx, msg).await? {
                        self.handle_add_channel(ctx, msg, args, &bot).await?;
                    } else {
                        self.send_no_permission_error(ctx, msg).await?;
                    }
                }
                "roles_list" => self.handle_roles_list(ctx, msg, &bot).await?,
                
                // Game management commands
                "todo" => {
                    if self.check_admin_perms(ctx, msg).await? {
                        self.handle_todo(ctx, msg, &bot).await?;
                    } else {
                        self.send_no_permission_error(ctx, msg).await?;
                    }
                }
                "recovery" => {
                    if self.check_admin_perms(ctx, msg).await? {
                        self.handle_recovery(ctx, msg, &bot).await?;
                    } else {
                        self.send_no_permission_error(ctx, msg).await?;
                    }
                }
                "speed" => {
                    if self.check_admin_perms(ctx, msg).await? {
                        self.handle_speed(ctx, msg, args, &bot).await?;
                    } else {
                        self.send_no_permission_error(ctx, msg).await?;
                    }
                }
                "speed_check" => self.handle_speed_check(ctx, msg, &bot).await?,
                "settings" => {
                    if self.check_admin_perms(ctx, msg).await? {
                        self.handle_settings(ctx, msg, args, &bot).await?;
                    } else {
                        self.send_no_permission_error(ctx, msg).await?;
                    }
                }
                "server" => {
                    if self.check_admin_perms(ctx, msg).await? {
                        self.handle_server(ctx, msg, &bot).await?;
                    } else {
                        self.send_no_permission_error(ctx, msg).await?;
                    }
                }
                
                // Fun/meme commands
                "meme" => self.handle_meme(ctx, msg, &bot).await?,
                "peed" => {
                    msg.reply(ctx, "💦 IM PISSING REALLY HARD AND ITS REALLY COOL 💦").await?;
                }
                "mylo" => {
                    msg.reply(ctx, "Mylo can maybe backpedal to Orphan if we need to if this doesn't land").await?;
                }
                "wolf_list" => {
                    msg.reply(ctx, "The wolf list? Are we still doing this? Stop talking about the wolf list.").await?;
                }
                
                // Journal system commands
                "journal" => {
                    if self.check_admin_perms(ctx, msg).await? {
                        self.handle_journal(ctx, msg, args, &bot).await?;
                    } else {
                        self.send_no_permission_error(ctx, msg).await?;
                    }
                }
                "journal_link" => {
                    if self.check_admin_perms(ctx, msg).await? {
                        self.handle_journal_link(ctx, msg, &bot).await?;
                    } else {
                        self.send_no_permission_error(ctx, msg).await?;
                    }
                }
                "journal_owner" => self.handle_journal_owner(ctx, msg, &bot).await?,
                "journal_unlink" => {
                    if self.check_admin_perms(ctx, msg).await? {
                        self.handle_journal_unlink(ctx, msg, &bot).await?;
                    } else {
                        self.send_no_permission_error(ctx, msg).await?;
                    }
                }
                "journal_assign" => {
                    if self.check_admin_perms(ctx, msg).await? {
                        self.handle_journal_assign(ctx, msg, args, &bot).await?;
                    } else {
                        self.send_no_permission_error(ctx, msg).await?;
                    }
                }
                "my_journal" => self.handle_my_journal(ctx, msg, &bot).await?,
                "ia" => {
                    if self.check_admin_perms(ctx, msg).await? {
                        self.handle_ia(ctx, msg, args, &bot).await?;
                    } else {
                        self.send_no_permission_error(ctx, msg).await?;
                    }
                }
                
                // Unknown command - try AI response
                _ => {
                    if let Some(response) = bot.generate_funny_response(&msg.content, &msg.author.name).await {
                        msg.reply(ctx, response).await?;
                    } else {
                        msg.reply(ctx, "❓ Unknown command. Type `Wolf.help` for available commands.").await?;
                    }
                }
            }
        }

        Ok(())
    }

    async fn check_admin_perms(&self, ctx: &Context, msg: &Message) -> Result<bool> {
        let guild_id = msg.guild_id.unwrap();
        let member = guild_id.member(ctx, msg.author.id).await?;
        let permissions = member.permissions(ctx).await?;
        Ok(permissions.administrator() || permissions.manage_guild())
    }

    async fn send_no_permission_error(&self, ctx: &Context, msg: &Message) -> Result<()> {
        msg.reply(ctx, "❌ You need administrator permissions to use this command.").await?;
        Ok(())
    }

    // Fast implementations of key commands
    async fn handle_ping(&self, ctx: &Context, msg: &Message) -> Result<()> {
        let now = std::time::Instant::now();
        let mut reply = msg.reply(ctx, "🏓 Pong!").await?;
        let latency = now.elapsed().as_millis();
        
        reply.edit(ctx, serenity::builder::EditMessage::new().content(format!("🏓 Pong! `{}ms`", latency))).await?;
        Ok(())
    }

    async fn handle_help(&self, ctx: &Context, msg: &Message) -> Result<()> {
        let embed = serenity::builder::CreateEmbed::default()
            .title("🐺 Werewolf Bot Commands")
            .description("
**Admin Commands:**
• `Wolf.setup <prefix> <num>` - Configure bot
• `Wolf.create` - Create new game
• `Wolf.start` - Start the game
• `Wolf.end` - End current game

**Player Commands:**
• `Wolf.in` - Join game
• `Wolf.out` - Leave game  
• `Wolf.vote <player>` - Vote for elimination
• `Wolf.retract` - Remove vote
• `Wolf.alive` - List alive players
            ")
            .color(0x0099ff)
            .footer(|f| f.text("Fast Rust implementation 🦀"));

        msg.channel_id.send_message(ctx, serenity::builder::CreateMessage::new().embed(embed)).await?;
        Ok(())
    }

    async fn handle_setup(&self, ctx: &Context, msg: &Message, args: &str, bot: &WerewolfBot) -> Result<()> {
        let parts: Vec<&str> = args.split_whitespace().collect();
        if parts.len() != 2 {
            let embed = serenity::builder::CreateEmbed::default()
                .title("🐺 Werewolf Bot Setup")
                .description("Usage: `Wolf.setup <prefix> <starting_number>`\n\nExample: `Wolf.setup Wolf. 1`")
                .color(0x0099ff);
            msg.channel_id.send_message(ctx, serenity::builder::CreateMessage::new().embed(embed)).await?;
            return Ok(());
        }

        let prefix = parts[0];
        let starting_num: i32 = parts[1].parse().unwrap_or(1);
        let guild_id = msg.guild_id.unwrap().get();

        let client = bot.pool.get().await?;
        client.execute(
            "INSERT INTO server_config (guild_id, prefix, starting_number) 
             VALUES ($1, $2, $3)
             ON CONFLICT (guild_id) 
             DO UPDATE SET prefix = $2, starting_number = $3",
            &[&(guild_id as i64), &prefix, &starting_num],
        ).await?;

        // Update cache
        self.cache.set_server_config(guild_id, ServerConfig {
            guild_id,
            prefix: prefix.to_string(),
            starting_number: starting_num,
        }).await;

        let embed = serenity::builder::CreateEmbed::default()
            .title("✅ Setup Complete!")
            .description(format!("Prefix: `{}`\nStarting number: `{}`", prefix, starting_num))
            .color(0x00ff00);
        
        msg.channel_id.send_message(ctx, serenity::builder::CreateMessage::new().embed(embed)).await?;
        Ok(())
    }

    // Placeholder implementations for other commands
    async fn handle_create(&self, ctx: &Context, msg: &Message, bot: &WerewolfBot) -> Result<()> {
        msg.reply(ctx, "🏗️ Create command (implementation in progress)").await?;
        Ok(())
    }

    async fn handle_start(&self, ctx: &Context, msg: &Message, bot: &WerewolfBot) -> Result<()> {
        msg.reply(ctx, "🚀 Start command (implementation in progress)").await?;
        Ok(())
    }

    async fn handle_end(&self, ctx: &Context, msg: &Message, bot: &WerewolfBot) -> Result<()> {
        msg.reply(ctx, "🏁 End command (implementation in progress)").await?;
        Ok(())
    }

    async fn handle_join(&self, ctx: &Context, msg: &Message, bot: &WerewolfBot) -> Result<()> {
        msg.reply(ctx, "👥 Join command (implementation in progress)").await?;
        Ok(())
    }

    async fn handle_leave(&self, ctx: &Context, msg: &Message, bot: &WerewolfBot) -> Result<()> {
        msg.reply(ctx, "👋 Leave command (implementation in progress)").await?;
        Ok(())
    }

    async fn handle_vote(&self, ctx: &Context, msg: &Message, args: &str, bot: &WerewolfBot) -> Result<()> {
        msg.reply(ctx, "🗳️ Vote command (implementation in progress)").await?;
        Ok(())
    }

    async fn handle_retract(&self, ctx: &Context, msg: &Message, bot: &WerewolfBot) -> Result<()> {
        msg.reply(ctx, "↩️ Retract command (implementation in progress)").await?;
        Ok(())
    }

    async fn handle_alive(&self, ctx: &Context, msg: &Message, bot: &WerewolfBot) -> Result<()> {
        msg.reply(ctx, "💚 Alive command (implementation in progress)").await?;
        Ok(())
    }

    // Core game flow commands
    async fn handle_next(&self, ctx: &Context, msg: &Message, bot: &WerewolfBot) -> Result<()> {
        let guild_id = msg.guild_id.unwrap().get();
        
        // Get active game
        let client = bot.pool.get().await?;
        let rows = client.query(
            "SELECT game_id, day_phase, day_number, guild_id FROM games 
             WHERE guild_id = $1 AND status = 'active'",
            &[&(guild_id as i64)],
        ).await?;

        if rows.is_empty() {
            msg.reply(ctx, "❌ No active game found.").await?;
            return Ok(());
        }

        let game_row = &rows[0];
        let game_id: i64 = game_row.get("game_id");
        let current_phase: bool = game_row.get("day_phase"); // true = day, false = night
        let current_day: i32 = game_row.get("day_number");

        let (new_phase, new_day) = if current_phase {
            // Currently day, switch to night
            (false, current_day)
        } else {
            // Currently night, switch to day and increment day number
            (true, current_day + 1)
        };

        // If switching from day to night, get voting results first
        if current_phase {
            // Get voting results before clearing votes
            let vote_results = client.query(
                "SELECT gp.user_id, COUNT(v.voter_user_id) as vote_count
                 FROM game_players gp
                 LEFT JOIN votes v ON gp.user_id = v.target_user_id AND v.game_id = $1
                 WHERE gp.game_id = $1 AND gp.is_alive = true
                 GROUP BY gp.user_id
                 HAVING COUNT(v.voter_user_id) > 0
                 ORDER BY vote_count DESC",
                &[&game_id],
            ).await?;

            if !vote_results.is_empty() {
                let mut results_text = String::from("📊 **Day Voting Results:**\n");
                for row in &vote_results {
                    let user_id: i64 = row.get("user_id");
                    let vote_count: i64 = row.get("vote_count");
                    let user = serenity::model::id::UserId::new(user_id as u64).to_user(ctx).await?;
                    results_text.push_str(&format!("• {} - {} votes\n", user.display_name(), vote_count));
                }

                let embed = serenity::builder::CreateEmbed::default()
                    .title("📊 End of Day Results")
                    .description(results_text)
                    .color(0xff6b35);

                msg.channel_id.send_message(ctx, serenity::builder::CreateMessage::new().embed(embed)).await?;
            }

            // Clear all votes
            client.execute(
                "DELETE FROM votes WHERE game_id = $1",
                &[&game_id],
            ).await?;
        }

        // Update game phase and day
        client.execute(
            "UPDATE games SET day_phase = $1, day_number = $2 WHERE game_id = $3",
            &[&new_phase, &new_day, &game_id],
        ).await?;

        // Invalidate cache
        self.cache.invalidate_game(guild_id).await;

        let phase_name = if new_phase { "Day" } else { "Night" };
        let embed = serenity::builder::CreateEmbed::default()
            .title(format!("🌅 {} {} Begins!", phase_name, new_day))
            .description(format!("The game has advanced to {} {}.", phase_name, new_day))
            .color(if new_phase { 0xffdd44 } else { 0x2c2f33 });

        msg.channel_id.send_message(ctx, serenity::builder::CreateMessage::new().embed(embed)).await?;
        Ok(())
    }

    async fn handle_refresh(&self, ctx: &Context, msg: &Message, bot: &WerewolfBot) -> Result<()> {
        let guild_id = msg.guild_id.unwrap().get();
        
        // Invalidate all caches for this guild
        self.cache.invalidate_game(guild_id).await;
        
        // Get fresh game state
        if let Some(game) = bot.get_active_game(guild_id).await? {
            let phase_name = if game.day_phase { "Day" } else { "Night" };
            let embed = serenity::builder::CreateEmbed::default()
                .title("🔄 Game State Refreshed")
                .description(format!(
                    "**Current Phase:** {} {}\n**Players:** {}\n**Status:** Active",
                    phase_name, game.day_number, game.players.len()
                ))
                .color(0x00ff00);

            msg.channel_id.send_message(ctx, serenity::builder::CreateMessage::new().embed(embed)).await?;
        } else {
            msg.reply(ctx, "🔄 Cache refreshed. No active game found.").await?;
        }
        Ok(())
    }

    async fn handle_inlist(&self, ctx: &Context, msg: &Message, bot: &WerewolfBot) -> Result<()> {
        let guild_id = msg.guild_id.unwrap().get();
        
        let client = bot.pool.get().await?;
        let game_rows = client.query(
            "SELECT game_id FROM games 
             WHERE guild_id = $1 AND status IN ('signup', 'active')",
            &[&(guild_id as i64)],
        ).await?;

        if game_rows.is_empty() {
            msg.reply(ctx, "❌ No active game available.").await?;
            return Ok(());
        }

        let game_id: i64 = game_rows[0].get("game_id");

        // Get all players in the game
        let player_rows = client.query(
            "SELECT user_id FROM game_players WHERE game_id = $1 ORDER BY user_id",
            &[&game_id],
        ).await?;

        if player_rows.is_empty() {
            msg.reply(ctx, "📝 No players have signed up yet.").await?;
            return Ok(());
        }

        let mut player_list = String::new();
        for (i, row) in player_rows.iter().enumerate() {
            let user_id: i64 = row.get("user_id");
            let user = serenity::model::id::UserId::new(user_id as u64).to_user(ctx).await?;
            player_list.push_str(&format!("{}. {}\n", i + 1, user.display_name()));
        }

        let embed = serenity::builder::CreateEmbed::default()
            .title(format!("📝 Player List ({} players)", player_rows.len()))
            .description(player_list)
            .color(0x0099ff);

        msg.channel_id.send_message(ctx, serenity::builder::CreateMessage::new().embed(embed)).await?;
        Ok(())
    }

    async fn handle_create_vote(&self, ctx: &Context, msg: &Message, bot: &WerewolfBot) -> Result<()> {
        let guild_id = msg.guild_id.unwrap().get();
        
        let client = bot.pool.get().await?;
        let rows = client.query(
            "SELECT game_id, day_phase, day_number FROM games 
             WHERE guild_id = $1 AND status = 'active'",
            &[&(guild_id as i64)],
        ).await?;

        if rows.is_empty() {
            msg.reply(ctx, "❌ No active game found.").await?;
            return Ok(());
        }

        let game_row = &rows[0];
        let day_phase: bool = game_row.get("day_phase");
        
        if !day_phase {
            msg.reply(ctx, "❌ Voting messages can only be created during the day phase.").await?;
            return Ok(());
        }

        // Create voting embed
        let embed = serenity::builder::CreateEmbed::default()
            .title("🗳️ Daily Voting")
            .description("Vote for who you think should be eliminated today.\n\nUse `Wolf.vote <player>` to cast your vote.\nUse `Wolf.retract` to remove your vote.")
            .color(0xff0000)
            .footer(|f| f.text("Voting is now open"));

        let vote_msg = msg.channel_id.send_message(ctx, serenity::builder::CreateMessage::new().embed(embed)).await?;
        
        msg.reply(ctx, format!("✅ Voting message created! [Jump to message]({})", 
                              format!("https://discord.com/channels/{}/{}/{}", 
                                     guild_id, msg.channel_id.get(), vote_msg.id.get()))).await?;
        Ok(())
    }

    async fn handle_get_votes(&self, ctx: &Context, msg: &Message, bot: &WerewolfBot) -> Result<()> {
        let guild_id = msg.guild_id.unwrap().get();
        
        let client = bot.pool.get().await?;
        let game_rows = client.query(
            "SELECT game_id, day_number FROM games 
             WHERE guild_id = $1 AND status = 'active'",
            &[&(guild_id as i64)],
        ).await?;

        if game_rows.is_empty() {
            msg.reply(ctx, "❌ No active game found.").await?;
            return Ok(());
        }

        let game_id: i64 = game_rows[0].get("game_id");

        // Get current votes
        let vote_rows = client.query(
            "SELECT target_user_id, COUNT(*) as vote_count
             FROM votes v
             JOIN game_players gp ON v.target_user_id = gp.user_id AND v.game_id = gp.game_id
             WHERE v.game_id = $1 AND gp.is_alive = true
             GROUP BY target_user_id
             ORDER BY vote_count DESC, target_user_id",
            &[&game_id],
        ).await?;

        if vote_rows.is_empty() {
            let embed = serenity::builder::CreateEmbed::default()
                .title("🗳️ Current Votes")
                .description("No votes have been cast yet.")
                .color(0x888888);

            msg.channel_id.send_message(ctx, serenity::builder::CreateMessage::new().embed(embed)).await?;
            return Ok(());
        }

        let mut vote_summary = String::new();
        let mut total_votes = 0i64;

        for row in &vote_rows {
            let target_user_id: i64 = row.get("target_user_id");
            let vote_count: i64 = row.get("vote_count");
            let user = serenity::model::id::UserId::new(target_user_id as u64).to_user(ctx).await?;
            
            vote_summary.push_str(&format!("**{}** - {} vote{}\n", 
                                          user.display_name(), 
                                          vote_count,
                                          if vote_count == 1 { "" } else { "s" }));
            total_votes += vote_count;
        }

        let embed = serenity::builder::CreateEmbed::default()
            .title("🗳️ Current Votes")
            .description(format!("{}\n**Total votes cast:** {}", vote_summary, total_votes))
            .color(0xff6600);

        msg.channel_id.send_message(ctx, serenity::builder::CreateMessage::new().embed(embed)).await?;
        Ok(())
    }

    // Server/Channel management commands
    async fn handle_server_roles(&self, ctx: &Context, msg: &Message, bot: &WerewolfBot) -> Result<()> {
        let guild_id = msg.guild_id.unwrap();
        let guild = guild_id.to_partial_guild(ctx).await?;
        
        let roles = guild.roles;
        let mut role_list = String::new();
        
        for (role_id, role) in roles.iter().take(20) { // Limit to first 20 roles
            if !role.everyone {
                role_list.push_str(&format!("• {} ({})\n", role.name, role_id.get()));
            }
        }
        
        if role_list.is_empty() {
            role_list = "No custom roles found.".to_string();
        }

        let embed = serenity::builder::CreateEmbed::default()
            .title("🎭 Server Roles")
            .description(role_list)
            .color(0x7289da);

        msg.channel_id.send_message(ctx, serenity::builder::CreateMessage::new().embed(embed)).await?;
        Ok(())
    }

    async fn handle_add_channel(&self, ctx: &Context, msg: &Message, args: &str, bot: &WerewolfBot) -> Result<()> {
        if args.trim().is_empty() {
            msg.reply(ctx, "❌ Please specify a channel name. Usage: `Wolf.add_channel <channel_name>`").await?;
            return Ok(());
        }

        let guild_id = msg.guild_id.unwrap();
        let channel_name = args.trim().replace(" ", "-").to_lowercase();

        // Create a new text channel
        match guild_id.create_channel(ctx, |c| {
            c.name(&channel_name)
             .kind(serenity::model::channel::ChannelType::Text)
        }).await {
            Ok(channel) => {
                let embed = serenity::builder::CreateEmbed::default()
                    .title("✅ Channel Created")
                    .description(format!("Created channel: <#{}>", channel.id.get()))
                    .color(0x00ff00);

                msg.channel_id.send_message(ctx, serenity::builder::CreateMessage::new().embed(embed)).await?;
            }
            Err(e) => {
                tracing::error!("Failed to create channel: {}", e);
                msg.reply(ctx, "❌ Failed to create channel. Check bot permissions.").await?;
            }
        }
        Ok(())
    }

    async fn handle_roles_list(&self, ctx: &Context, msg: &Message, bot: &WerewolfBot) -> Result<()> {
        // This would typically come from a roles database table
        let embed = serenity::builder::CreateEmbed::default()
            .title("🃏 Available Werewolf Roles")
            .description("
**Village Team:**
• Villager - No special abilities
• Seer - Can investigate players
• Doctor - Can protect players
• Bodyguard - Can protect and attack

**Wolf Team:**
• Werewolf - Can kill during night
• Alpha Wolf - Enhanced werewolf

**Independent:**
• Jester - Wins if lynched
• Serial Killer - Independent killer
            ")
            .color(0x9932cc);

        msg.channel_id.send_message(ctx, serenity::builder::CreateMessage::new().embed(embed)).await?;
        Ok(())
    }

    // Game management commands
    async fn handle_todo(&self, ctx: &Context, msg: &Message, bot: &WerewolfBot) -> Result<()> {
        let embed = serenity::builder::CreateEmbed::default()
            .title("📋 Game TODO List")
            .description("
**Pending Actions:**
• Review night actions
• Process eliminations  
• Update player status
• Advance to next phase

*This is a placeholder - todo system to be implemented*
            ")
            .color(0xffa500);

        msg.channel_id.send_message(ctx, serenity::builder::CreateMessage::new().embed(embed)).await?;
        Ok(())
    }

    async fn handle_recovery(&self, ctx: &Context, msg: &Message, bot: &WerewolfBot) -> Result<()> {
        let guild_id = msg.guild_id.unwrap().get();
        
        // Clear cache and reload game state
        self.cache.invalidate_game(guild_id).await;
        
        let embed = serenity::builder::CreateEmbed::default()
            .title("🔧 Game Recovery")
            .description("
Game state has been refreshed from database.
All cached data cleared and reloaded.

If issues persist, please contact an administrator.
            ")
            .color(0xff8c00);

        msg.channel_id.send_message(ctx, serenity::builder::CreateMessage::new().embed(embed)).await?;
        Ok(())
    }

    async fn handle_speed(&self, ctx: &Context, msg: &Message, args: &str, bot: &WerewolfBot) -> Result<()> {
        let guild_id = msg.guild_id.unwrap().get();
        
        let client = bot.pool.get().await?;
        let game_rows = client.query(
            "SELECT game_id FROM games 
             WHERE guild_id = $1 AND status = 'active'",
            &[&(guild_id as i64)],
        ).await?;

        if game_rows.is_empty() {
            msg.reply(ctx, "❌ No active game found.").await?;
            return Ok(());
        }

        let game_id: i64 = game_rows[0].get("game_id");
        let args_parts: Vec<&str> = args.trim().split_whitespace().collect();

        // Handle abort command
        if args_parts.len() > 0 && args_parts[0].to_lowercase() == "abort" {
            return self.handle_speed_abort(ctx, msg, game_id, bot).await;
        }

        // Check if speed target is provided
        if args_parts.is_empty() {
            msg.reply(ctx, "❌ Please provide a valid speed target number. Usage: `Wolf.speed <number> [emoji]` or `Wolf.speed abort`").await?;
            return Ok(());
        }

        let speed_target: i32 = match args_parts[0].parse() {
            Ok(num) if num >= 1 => num,
            _ => {
                msg.reply(ctx, "❌ Please provide a valid speed target number. Usage: `Wolf.speed <number> [emoji]` or `Wolf.speed abort`").await?;
                return Ok(());
            }
        };

        // Parse custom emoji (optional second parameter)
        let custom_emoji = if args_parts.len() > 1 {
            args_parts[1].to_string()
        } else {
            "⚡".to_string()
        };

        // Check if there's already an active speed vote
        let existing_speed = client.query(
            "SELECT message_id FROM game_speed WHERE game_id = $1",
            &[&game_id],
        ).await?;

        if !existing_speed.is_empty() {
            msg.reply(ctx, "❌ There is already an active speed vote. Use `Wolf.speed abort` to cancel it first.").await?;
            return Ok(());
        }

        // Create the speed vote embed
        let embed = serenity::builder::CreateEmbed::default()
            .title("⚡ Speed Vote!")
            .description(format!("Bunch of impatient players want to speed up the game! React with {} if you agree!", custom_emoji))
            .field("Target", speed_target.to_string(), true)
            .field("Status", "Waiting for reactions...", true)
            .color(0xffd700)
            .timestamp(chrono::Utc::now());

        // Send speed vote message
        let speed_message = msg.channel_id.send_message(ctx, 
            serenity::builder::CreateMessage::new()
                .content("@everyone") // Ping all players
                .embed(embed)
        ).await?;

        // Try to add emoji reaction
        let final_emoji = match speed_message.react(ctx, custom_emoji.clone()).await {
            Ok(_) => custom_emoji,
            Err(_) => {
                // Fallback to default emoji if custom emoji fails
                speed_message.react(ctx, "⚡").await.ok();
                msg.reply(ctx, format!("⚠️ Unknown emoji \"{}\" provided. Using default emoji ⚡ instead.", custom_emoji)).await?;
                "⚡".to_string()
            }
        };

        // Store speed vote in database (placeholder - would need proper game_speed table)
        // client.execute(
        //     "INSERT INTO game_speed (game_id, channel_id, message_id, target_count, emoji, created_at)
        //      VALUES ($1, $2, $3, $4, $5, NOW())",
        //     &[&game_id, &(msg.channel_id.get() as i64), &(speed_message.id.get() as i64), &speed_target, &final_emoji],
        // ).await?;

        msg.reply(ctx, format!("✅ Speed vote created! Target: {} reactions with {}", speed_target, final_emoji)).await?;
        Ok(())
    }

    async fn handle_speed_abort(&self, ctx: &Context, msg: &Message, game_id: i64, bot: &WerewolfBot) -> Result<()> {
        let client = bot.pool.get().await?;
        
        // Check if there's an active speed vote (placeholder query)
        let speed_rows = client.query(
            "SELECT message_id, channel_id FROM game_speed WHERE game_id = $1",
            &[&game_id],
        ).await.unwrap_or_default(); // Graceful fallback since table may not exist

        if speed_rows.is_empty() {
            msg.reply(ctx, "❌ No active speed vote to abort.").await?;
            return Ok(());
        }

        // Delete the speed vote from database (placeholder)
        // client.execute("DELETE FROM game_speed WHERE game_id = $1", &[&game_id]).await?;

        let embed = serenity::builder::CreateEmbed::default()
            .title("⚡ Speed Vote Aborted")
            .description("The speed vote has been cancelled by a moderator.")
            .color(0xff0000)
            .timestamp(chrono::Utc::now());

        msg.channel_id.send_message(ctx, serenity::builder::CreateMessage::new().embed(embed)).await?;
        msg.reply(ctx, "✅ Speed vote aborted successfully.").await?;
        Ok(())
    }

    async fn handle_speed_check(&self, ctx: &Context, msg: &Message, bot: &WerewolfBot) -> Result<()> {
        let guild_id = msg.guild_id.unwrap().get();
        
        let client = bot.pool.get().await?;
        let game_rows = client.query(
            "SELECT game_id, day_phase, day_number, phase_change_at FROM games 
             WHERE guild_id = $1 AND status = 'active'",
            &[&(guild_id as i64)],
        ).await?;

        if game_rows.is_empty() {
            msg.reply(ctx, "❌ No active game found.").await?;
            return Ok(());
        }

        let game_row = &game_rows[0];
        let game_id: i64 = game_row.get("game_id");
        let day_phase: bool = game_row.get("day_phase");
        let day_number: i32 = game_row.get("day_number");
        let phase_change_at: Option<DateTime<Utc>> = game_row.get("phase_change_at");

        if phase_change_at.is_none() {
            msg.reply(ctx, "❌ No phase change time recorded for this game.").await?;
            return Ok(());
        }

        let phase_change_time = phase_change_at.unwrap();
        let now = Utc::now();
        let time_remaining = phase_change_time - now;
        
        let phase_name = if day_phase { "Day" } else { "Night" };
        let time_str = if time_remaining.num_seconds() > 0 {
            let hours = time_remaining.num_hours();
            let minutes = (time_remaining.num_minutes() % 60).abs();
            if hours > 0 {
                format!("{}h {}m remaining", hours, minutes)
            } else {
                format!("{}m remaining", time_remaining.num_minutes())
            }
        } else {
            "⚠️ Phase overdue!".to_string()
        };

        // Get alive players count
        let player_rows = client.query(
            "SELECT COUNT(*) as alive_count FROM game_players 
             WHERE game_id = $1 AND is_alive = true",
            &[&game_id],
        ).await?;

        let alive_count: i64 = player_rows[0].get("alive_count");

        let embed = serenity::builder::CreateEmbed::default()
            .title("⚡ Game Speed Check")
            .description(format!(
                "**Phase:** {} {}\n**Time:** {}\n**Alive Players:** {}\n**Next:** {}", 
                phase_name, 
                day_number,
                time_str,
                alive_count,
                if day_phase { "Night" } else { "Day" }
            ))
            .color(if time_remaining.num_seconds() > 0 { 0x00ff00 } else { 0xff6600 })
            .timestamp(now);

        // If overdue, ping alive players  
        let message_content = if time_remaining.num_seconds() <= 0 {
            "@here Phase is overdue! Please submit your actions or votes."
        } else {
            ""
        };

        msg.channel_id.send_message(ctx, 
            serenity::builder::CreateMessage::new()
                .content(message_content)
                .embed(embed)
        ).await?;
        
        Ok(())
    }

    async fn handle_settings(&self, ctx: &Context, msg: &Message, args: &str, bot: &WerewolfBot) -> Result<()> {
        if args.trim().is_empty() {
            // Show current settings
            let embed = serenity::builder::CreateEmbed::default()
                .title("⚙️ Bot Settings")
                .description("
**Current Settings:**
• Prefix: Wolf.
• Game Speed: Normal
• Auto-advance: Disabled
• Night Actions: Enabled

Use `Wolf.settings <key> <value>` to modify
                ")
                .color(0x808080);

            msg.channel_id.send_message(ctx, serenity::builder::CreateMessage::new().embed(embed)).await?;
        } else {
            msg.reply(ctx, "⚙️ Settings modification coming soon!").await?;
        }
        Ok(())
    }

    async fn handle_server(&self, ctx: &Context, msg: &Message, bot: &WerewolfBot) -> Result<()> {
        let guild_id = msg.guild_id.unwrap();
        let guild = guild_id.to_partial_guild(ctx).await?;
        
        let embed = serenity::builder::CreateEmbed::default()
            .title("🏰 Server Information")
            .description(format!("
**Server:** {}
**ID:** {}
**Members:** {}
**Channels:** {}
**Roles:** {}
            ", 
            guild.name,
            guild.id.get(),
            guild.member_count.unwrap_or(0),
            guild.channels(ctx).await?.len(),
            guild.roles.len()
            ))
            .color(0x5865f2);

        msg.channel_id.send_message(ctx, serenity::builder::CreateMessage::new().embed(embed)).await?;
        Ok(())
    }

    async fn handle_meme(&self, ctx: &Context, msg: &Message, bot: &WerewolfBot) -> Result<()> {
        let memes = [
            "🐺 \"I'm not a werewolf!\" - Every werewolf ever",
            "🤔 *votes for the confirmed villager*",
            "📝 Day 1: Everyone is suspicious",
            "🌙 *kills the person who was about to solve the game*",
            "🗳️ \"Let's policy lynch the lurker\" *lynches the cop*",
            "💭 \"I have a guilty on [player]\" *gets immediately voted out*",
        ];
        
        use std::collections::hash_map::DefaultHasher;
        use std::hash::{Hash, Hasher};
        
        let mut hasher = DefaultHasher::new();
        msg.author.id.get().hash(&mut hasher);
        let hash = hasher.finish();
        
        let meme = memes[hash as usize % memes.len()];
        msg.reply(ctx, meme).await?;
        Ok(())
    }

    // Journal system commands
    async fn handle_journal(&self, ctx: &Context, msg: &Message, args: &str, bot: &WerewolfBot) -> Result<()> {
        if msg.mentions.users.is_empty() {
            msg.reply(ctx, "❌ Please mention a user to create a journal for. Usage: `Wolf.journal @user`").await?;
            return Ok(());
        }

        let target_user = &msg.mentions.users[0];
        let guild_id = msg.guild_id.unwrap();
        
        // Check if the mentioned user is in the server
        match guild_id.member(ctx, target_user.id).await {
            Ok(_) => {
                // Create journal channel
                let channel_name = format!("{}-journal", target_user.name.to_lowercase().replace(" ", "-"));
                
                match guild_id.create_channel(ctx, |c| {
                    c.name(&channel_name)
                     .kind(serenity::model::channel::ChannelType::Text)
                     .topic(&format!("Private journal for {}", target_user.display_name()))
                }).await {
                    Ok(channel) => {
                        let embed = serenity::builder::CreateEmbed::default()
                            .title("📔 Journal Created")
                            .description(format!("Created journal channel <#{}> for {}", 
                                               channel.id.get(), target_user.display_name()))
                            .color(0x8b4513);

                        msg.channel_id.send_message(ctx, serenity::builder::CreateMessage::new().embed(embed)).await?;
                    }
                    Err(e) => {
                        tracing::error!("Failed to create journal channel: {}", e);
                        msg.reply(ctx, "❌ Failed to create journal channel. Check bot permissions.").await?;
                    }
                }
            }
            Err(_) => {
                msg.reply(ctx, "❌ That user is not in this server.").await?;
            }
        }
        Ok(())
    }

    async fn handle_journal_link(&self, ctx: &Context, msg: &Message, bot: &WerewolfBot) -> Result<()> {
        let guild_id = msg.guild_id.unwrap();
        
        // Get all journal channels (channels ending with -journal)
        let channels = guild_id.channels(ctx).await?;
        let journal_channels: Vec<_> = channels.values()
            .filter(|channel| channel.name.ends_with("-journal"))
            .collect();

        if journal_channels.is_empty() {
            msg.reply(ctx, "❌ No journal channels found (channels ending with \"-journal\").").await?;
            return Ok(());
        }

        let mut journal_list = String::new();
        for channel in journal_channels.iter().take(10) {
            journal_list.push_str(&format!("• <#{}> ({})\n", channel.id.get(), channel.name));
        }

        let embed = serenity::builder::CreateEmbed::default()
            .title("📔 Journal Channels")
            .description(format!("Found {} journal channels:\n\n{}", journal_channels.len(), journal_list))
            .color(0x8b4513);

        msg.channel_id.send_message(ctx, serenity::builder::CreateMessage::new().embed(embed)).await?;
        Ok(())
    }

    async fn handle_journal_owner(&self, ctx: &Context, msg: &Message, bot: &WerewolfBot) -> Result<()> {
        let channel_name = &msg.channel_id.to_channel(ctx).await?
            .guild()
            .map(|gc| gc.name.clone())
            .unwrap_or_else(|| "unknown".to_string());
            
        if !channel_name.ends_with("-journal") {
            msg.reply(ctx, "❌ This command can only be used in a journal channel.").await?;
            return Ok(());
        }

        // Extract username from channel name (remove -journal suffix)
        let username = channel_name.strip_suffix("-journal").unwrap_or("unknown");
        
        let embed = serenity::builder::CreateEmbed::default()
            .title("📔 Journal Owner")
            .description(format!("This journal belongs to: **{}**", username))
            .color(0x8b4513);

        msg.channel_id.send_message(ctx, serenity::builder::CreateMessage::new().embed(embed)).await?;
        Ok(())
    }

    async fn handle_journal_unlink(&self, ctx: &Context, msg: &Message, bot: &WerewolfBot) -> Result<()> {
        let channel_name = &msg.channel_id.to_channel(ctx).await?
            .guild()
            .map(|gc| gc.name.clone())
            .unwrap_or_else(|| "unknown".to_string());
            
        if !channel_name.ends_with("-journal") {
            msg.reply(ctx, "❌ This command can only be used in a journal channel.").await?;
            return Ok(());
        }

        // For now, just confirm the action (database operations would be needed for full implementation)
        let embed = serenity::builder::CreateEmbed::default()
            .title("🔓 Journal Unlinked")
            .description("Journal has been unlinked from its owner.\n*Database implementation needed for persistence*")
            .color(0xff8c00);

        msg.channel_id.send_message(ctx, serenity::builder::CreateMessage::new().embed(embed)).await?;
        Ok(())
    }

    async fn handle_journal_assign(&self, ctx: &Context, msg: &Message, args: &str, bot: &WerewolfBot) -> Result<()> {
        let channel_name = &msg.channel_id.to_channel(ctx).await?
            .guild()
            .map(|gc| gc.name.clone())
            .unwrap_or_else(|| "unknown".to_string());
            
        if !channel_name.ends_with("-journal") {
            msg.reply(ctx, "❌ This command can only be used in a journal channel.").await?;
            return Ok(());
        }

        if msg.mentions.users.is_empty() {
            msg.reply(ctx, "❌ Please mention a user to assign this journal to. Usage: `Wolf.journal_assign @user`").await?;
            return Ok(());
        }

        let target_user = &msg.mentions.users[0];
        
        let embed = serenity::builder::CreateEmbed::default()
            .title("📔 Journal Assigned")
            .description(format!("Journal has been assigned to: {}\n*Database implementation needed for persistence*", 
                               target_user.display_name()))
            .color(0x8b4513);

        msg.channel_id.send_message(ctx, serenity::builder::CreateMessage::new().embed(embed)).await?;
        Ok(())
    }

    async fn handle_my_journal(&self, ctx: &Context, msg: &Message, bot: &WerewolfBot) -> Result<()> {
        let guild_id = msg.guild_id.unwrap();
        let user_name = msg.author.name.to_lowercase().replace(" ", "-");
        let expected_channel_name = format!("{}-journal", user_name);

        // Look for user's journal channel
        let channels = guild_id.channels(ctx).await?;
        let user_journal = channels.values()
            .find(|channel| channel.name == expected_channel_name);

        match user_journal {
            Some(channel) => {
                let embed = serenity::builder::CreateEmbed::default()
                    .title("📔 Your Journal")
                    .description(format!("Your journal: <#{}>", channel.id.get()))
                    .color(0x8b4513);

                msg.channel_id.send_message(ctx, serenity::builder::CreateMessage::new().embed(embed)).await?;
            }
            None => {
                msg.reply(ctx, "❌ You don't have a journal channel. An admin can create one with `Wolf.journal @you`").await?;
            }
        }
        Ok(())
    }

    async fn handle_ia(&self, ctx: &Context, msg: &Message, args: &str, bot: &WerewolfBot) -> Result<()> {
        if args.trim().is_empty() {
            let embed = serenity::builder::CreateEmbed::default()
                .title("⚡ Immediate Actions")
                .description("
**Available IA Commands:**
• `Wolf.ia process` - Process pending night actions
• `Wolf.ia reset` - Reset action queue
• `Wolf.ia status` - Show action status

*Full IA system to be implemented*
                ")
                .color(0xff4500);

            msg.channel_id.send_message(ctx, serenity::builder::CreateMessage::new().embed(embed)).await?;
        } else {
            let action = args.trim().to_lowercase();
            match action.as_str() {
                "process" => {
                    msg.reply(ctx, "⚡ Processing immediate actions... (implementation needed)").await?;
                }
                "reset" => {
                    msg.reply(ctx, "🔄 Action queue reset. (implementation needed)").await?;
                }
                "status" => {
                    msg.reply(ctx, "📊 No pending actions. (implementation needed)").await?;
                }
                _ => {
                    msg.reply(ctx, "❌ Unknown IA command. Use: process, reset, or status").await?;
                }
            }
        }
        Ok(())
    }
}