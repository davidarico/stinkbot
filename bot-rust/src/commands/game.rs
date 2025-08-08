use serenity::framework::standard::macros::command;
use serenity::framework::standard::{Args, CommandResult};
use serenity::model::prelude::*;
use serenity::prelude::*;
use serenity::builder::{CreateEmbed, CreateMessage};
use crate::werewolf::{WerewolfBot, GameStatus};
use crate::DbPoolKey;

#[command]
#[description("Set up the werewolf bot for this server")]
#[usage("[prefix] [starting_number]")]
async fn setup(ctx: &Context, msg: &Message, args: Args) -> CommandResult {
    let data = ctx.data.read().await;
    let pool = data.get::<DbPoolKey>().unwrap();
    let bot = WerewolfBot::new(pool.clone());

    if !has_admin_perms(ctx, msg).await? {
        msg.reply(ctx, "❌ You need administrator permissions to use this command.").await?;
        return Ok(());
    }

    let args_vec: Vec<&str> = args.rest().split_whitespace().collect();
    if args_vec.len() != 2 {
        let embed = CreateEmbed::default()
            .title("🐺 Werewolf Bot Setup")
            .description("Usage: `Wolf.setup <prefix> <starting_number>`\n\nExample: `Wolf.setup Wolf. 1`")
            .color(0x0099ff);
        msg.channel_id.send_message(ctx, CreateMessage::new().embed(embed)).await?;
        return Ok(());
    }

    let prefix = args_vec[0];
    let starting_num: i32 = args_vec[1].parse().unwrap_or(1);

    let client = pool.get().await?;
    client.execute(
        "INSERT INTO server_config (guild_id, prefix, starting_number) 
         VALUES ($1, $2, $3)
         ON CONFLICT (guild_id) 
         DO UPDATE SET prefix = $2, starting_number = $3",
        &[&(msg.guild_id.unwrap().get() as i64), &prefix, &starting_num],
    ).await?;

    let embed = CreateEmbed::default()
        .title("✅ Setup Complete!")
        .description(format!("Prefix: `{}`\nStarting number: `{}`", prefix, starting_num))
        .color(0x00ff00);
    
    msg.channel_id.send_message(ctx, CreateMessage::new().embed(embed)).await?;
    Ok(())
}

#[command]
#[description("Create a new werewolf game")]
async fn create(ctx: &Context, msg: &Message) -> CommandResult {
    let data = ctx.data.read().await;
    let pool = data.get::<DbPoolKey>().unwrap();
    let bot = WerewolfBot::new(pool.clone());

    if !has_admin_perms(ctx, msg).await? {
        msg.reply(ctx, "❌ You need administrator permissions to use this command.").await?;
        return Ok(());
    }

    let guild_id = msg.guild_id.unwrap().get();
    
    if let Some(_game) = bot.get_active_game(guild_id).await? {
        msg.reply(ctx, "❌ There is already an active game. Please finish the current game first.").await?;
        return Ok(());
    }

    let client = pool.get().await?;
    let row = client.query_one(
        "INSERT INTO games (guild_id, status, created_by, day_phase, day_number)
         VALUES ($1, 'signup', $2, true, 0)
         RETURNING game_id",
        &[&(guild_id as i64), &(msg.author.id.get() as i64)],
    ).await?;

    let game_id: i64 = row.get(0);

    let embed = CreateEmbed::default()
        .title("🐺 New Werewolf Game Created!")
        .description(format!("Game ID: {}\nStatus: Open for signups\n\nUse `Wolf.in` to join!", game_id))
        .color(0x0099ff);

    msg.channel_id.send_message(ctx, CreateMessage::new().embed(embed)).await?;
    Ok(())
}

#[command]
#[aliases("begin")]
#[description("Start the werewolf game")]
async fn start(ctx: &Context, msg: &Message) -> CommandResult {
    let data = ctx.data.read().await;
    let pool = data.get::<DbPoolKey>().unwrap();
    let bot = WerewolfBot::new(pool.clone());

    if !has_admin_perms(ctx, msg).await? {
        msg.reply(ctx, "❌ You need administrator permissions to use this command.").await?;
        return Ok(());
    }

    let guild_id = msg.guild_id.unwrap().get();
    let game = match bot.get_active_game(guild_id).await? {
        Some(game) => game,
        None => {
            msg.reply(ctx, "❌ No active game found. Create one first with `Wolf.create`.").await?;
            return Ok(());
        }
    };

    if !matches!(game.status, GameStatus::Signup) {
        msg.reply(ctx, "❌ Game is not in signup phase.").await?;
        return Ok(());
    }

    if game.players.len() < 3 {
        msg.reply(ctx, "❌ Need at least 3 players to start a game.").await?;
        return Ok(());
    }

    let client = pool.get().await?;
    client.execute(
        "UPDATE games SET status = 'active', day_number = 1 WHERE game_id = $1",
        &[&game.game_id],
    ).await?;

    let embed = CreateEmbed::default()
        .title("🌅 Game Started!")
        .description(format!("Day 1 has begun!\n{} players are in the game.", game.players.len()))
        .color(0xffff00);

    msg.channel_id.send_message(ctx, CreateMessage::new().embed(embed)).await?;
    Ok(())
}

#[command]
#[description("End the current game")]
async fn end(ctx: &Context, msg: &Message) -> CommandResult {
    let data = ctx.data.read().await;
    let pool = data.get::<DbPoolKey>().unwrap();
    let bot = WerewolfBot::new(pool.clone());

    if !has_admin_perms(ctx, msg).await? {
        msg.reply(ctx, "❌ You need administrator permissions to use this command.").await?;
        return Ok(());
    }

    let guild_id = msg.guild_id.unwrap().get();
    let game = match bot.get_active_game(guild_id).await? {
        Some(game) => game,
        None => {
            msg.reply(ctx, "❌ No active game found.").await?;
            return Ok(());
        }
    };

    let client = pool.get().await?;
    client.execute(
        "UPDATE games SET status = 'ended', ended_at = NOW() WHERE game_id = $1",
        &[&game.game_id],
    ).await?;

    msg.reply(ctx, "✅ Game ended successfully.").await?;
    Ok(())
}

#[command]
#[description("List all alive players")]
async fn alive(ctx: &Context, msg: &Message) -> CommandResult {
    let data = ctx.data.read().await;
    let pool = data.get::<DbPoolKey>().unwrap();
    let bot = WerewolfBot::new(pool.clone());

    let guild_id = msg.guild_id.unwrap().get();
    let game = match bot.get_active_game(guild_id).await? {
        Some(game) => game,
        None => {
            msg.reply(ctx, "❌ No active game found.").await?;
            return Ok(());
        }
    };

    let alive_players: Vec<_> = game.players.iter()
        .filter(|p| p.is_alive)
        .collect();

    if alive_players.is_empty() {
        msg.reply(ctx, "No players are alive.").await?;
        return Ok(());
    }

    let mut description = String::new();
    for (i, player) in alive_players.iter().enumerate() {
        let user = UserId::new(player.user_id).to_user(ctx).await?;
        description.push_str(&format!("{}. {}\n", i + 1, user.display_name()));
    }

    let embed = CreateEmbed::default()
        .title(format!("🫀 Alive Players ({})", alive_players.len()))
        .description(description)
        .color(0x00ff00);

    msg.channel_id.send_message(ctx, CreateMessage::new().embed(embed)).await?;
    Ok(())
}

#[command]
#[description("Refresh/update game state")]
async fn refresh(ctx: &Context, msg: &Message) -> CommandResult {
    msg.reply(ctx, "🔄 Game state refreshed.").await?;
    Ok(())
}

#[command]
#[description("Show help information")]
async fn help(ctx: &Context, msg: &Message) -> CommandResult {
    let embed = CreateEmbed::default()
        .title("🐺 Werewolf Bot Commands")
        .description("
**Admin Commands:**
• `Wolf.setup <prefix> <num>` - Configure bot for server
• `Wolf.create` - Create new game
• `Wolf.start` - Start the game
• `Wolf.end` - End current game

**Player Commands:**
• `Wolf.in` - Join game
• `Wolf.out` - Leave game  
• `Wolf.vote <player>` - Vote for elimination
• `Wolf.retract` - Remove your vote
• `Wolf.alive` - List alive players
        ")
        .color(0x0099ff);

    msg.channel_id.send_message(ctx, CreateMessage::new().embed(embed)).await?;
    Ok(())
}

async fn has_admin_perms(ctx: &Context, msg: &Message) -> Result<bool, serenity::Error> {
    let guild_id = msg.guild_id.unwrap();
    let member = guild_id.member(ctx, msg.author.id).await?;
    let permissions = member.permissions(ctx).await?;
    Ok(permissions.administrator() || permissions.manage_guild())
}