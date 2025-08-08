use serenity::framework::standard::macros::command;
use serenity::framework::standard::{Args, CommandResult};
use serenity::model::prelude::*;
use serenity::prelude::*;
use serenity::builder::{CreateEmbed, CreateMessage};
use crate::werewolf::{WerewolfBot, GameStatus};
use crate::DbPoolKey;

#[command]
#[aliases("in")]
#[description("Join the current werewolf game")]
async fn join_game(ctx: &Context, msg: &Message) -> CommandResult {
    let data = ctx.data.read().await;
    let pool = data.get::<DbPoolKey>().unwrap();
    let bot = WerewolfBot::new(pool.clone());

    let guild_id = msg.guild_id.unwrap().get();
    let game = match bot.get_active_game(guild_id).await? {
        Some(game) => game,
        None => {
            msg.reply(ctx, "❌ No active game available for signups.").await?;
            return Ok(());
        }
    };

    if !matches!(game.status, GameStatus::Signup) {
        msg.reply(ctx, "❌ Game is not accepting new players.").await?;
        return Ok(());
    }

    let user_id = msg.author.id.get() as i64;
    if game.players.iter().any(|p| p.user_id == msg.author.id.get()) {
        msg.reply(ctx, "❌ You are already signed up for this game.").await?;
        return Ok(());
    }

    let client = pool.get().await?;
    client.execute(
        "INSERT INTO game_players (game_id, user_id, is_alive) VALUES ($1, $2, true)",
        &[&game.game_id, &user_id],
    ).await?;

    let player_count = game.players.len() + 1;
    let embed = CreateEmbed::default()
        .title("✅ Joined Game!")
        .description(format!("{} is now in the game! ({} players total)", 
                           msg.author.display_name(), player_count))
        .color(0x00ff00);

    msg.channel_id.send_message(ctx, CreateMessage::new().embed(embed)).await?;
    Ok(())
}

#[command]
#[aliases("out")]
#[description("Leave the current werewolf game")]
async fn leave(ctx: &Context, msg: &Message) -> CommandResult {
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

    let user_id = msg.author.id.get() as i64;
    if !game.players.iter().any(|p| p.user_id == msg.author.id.get()) {
        msg.reply(ctx, "❌ You are not in the current game.").await?;
        return Ok(());
    }

    let client = pool.get().await?;
    let affected = client.execute(
        "DELETE FROM game_players WHERE game_id = $1 AND user_id = $2",
        &[&game.game_id, &user_id],
    ).await?;

    if affected == 0 {
        msg.reply(ctx, "❌ You were not in the game.").await?;
        return Ok(());
    }

    let player_count = game.players.len().saturating_sub(1);
    let embed = CreateEmbed::default()
        .title("👋 Left Game")
        .description(format!("{} left the game. ({} players remaining)", 
                           msg.author.display_name(), player_count))
        .color(0xff9900);

    msg.channel_id.send_message(ctx, CreateMessage::new().embed(embed)).await?;
    Ok(())
}

#[command]
#[description("Vote to eliminate a player")]
#[usage("<player_name_or_number>")]
async fn vote(ctx: &Context, msg: &Message, args: Args) -> CommandResult {
    let data = ctx.data.read().await;
    let pool = data.get::<DbPoolKey>().unwrap();
    let bot = WerewolfBot::new(pool.clone());

    let target = args.rest();
    if target.is_empty() {
        msg.reply(ctx, "❌ Please specify who to vote for.").await?;
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

    if !matches!(game.status, GameStatus::Active) {
        msg.reply(ctx, "❌ Game is not in progress.").await?;
        return Ok(());
    }

    let voter_id = msg.author.id.get();
    let voter_player = game.players.iter().find(|p| p.user_id == voter_id);
    
    if let Some(player) = voter_player {
        if !player.is_alive {
            msg.reply(ctx, "❌ Dead players cannot vote.").await?;
            return Ok(());
        }
    } else {
        msg.reply(ctx, "❌ You are not in this game.").await?;
        return Ok(());
    }

    let target_player = find_player_by_name_or_number(ctx, &game.players, target).await?;
    let target_user_id = match target_player {
        Some(player) => player.user_id,
        None => {
            msg.reply(ctx, "❌ Player not found.").await?;
            return Ok(());
        }
    };

    if target_user_id == voter_id {
        msg.reply(ctx, "❌ You cannot vote for yourself.").await?;
        return Ok(());
    }

    let client = pool.get().await?;
    client.execute(
        "UPDATE game_players SET votes_for = $3 
         WHERE game_id = $1 AND user_id = $2",
        &[&game.game_id, &(voter_id as i64), &(target_user_id as i64)],
    ).await?;

    let target_user = UserId::new(target_user_id).to_user(ctx).await?;
    let embed = CreateEmbed::default()
        .title("🗳️ Vote Cast")
        .description(format!("{} votes for {}", 
                           msg.author.display_name(), target_user.display_name()))
        .color(0xff0000);

    msg.channel_id.send_message(ctx, CreateMessage::new().embed(embed)).await?;
    Ok(())
}

#[command]
#[description("Retract your vote")]
async fn retract(ctx: &Context, msg: &Message) -> CommandResult {
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

    let voter_id = msg.author.id.get();
    let voter_player = game.players.iter().find(|p| p.user_id == voter_id);
    
    if let Some(player) = voter_player {
        if player.votes_for.is_none() {
            msg.reply(ctx, "❌ You haven't voted for anyone.").await?;
            return Ok(());
        }
    } else {
        msg.reply(ctx, "❌ You are not in this game.").await?;
        return Ok(());
    }

    let client = pool.get().await?;
    client.execute(
        "UPDATE game_players SET votes_for = NULL 
         WHERE game_id = $1 AND user_id = $2",
        &[&game.game_id, &(voter_id as i64)],
    ).await?;

    let embed = CreateEmbed::default()
        .title("↩️ Vote Retracted")
        .description(format!("{} retracted their vote", msg.author.display_name()))
        .color(0x888888);

    msg.channel_id.send_message(ctx, CreateMessage::new().embed(embed)).await?;
    Ok(())
}

async fn find_player_by_name_or_number(
    ctx: &Context, 
    players: &[crate::werewolf::Player], 
    target: &str
) -> Result<Option<crate::werewolf::Player>, serenity::Error> {
    if let Ok(num) = target.parse::<usize>() {
        if num > 0 && num <= players.len() {
            return Ok(Some(players[num - 1].clone()));
        }
    }

    for player in players {
        let user = UserId::new(player.user_id).to_user(ctx).await?;
        if user.name.to_lowercase().contains(&target.to_lowercase()) ||
           user.display_name().to_lowercase().contains(&target.to_lowercase()) {
            return Ok(Some(player.clone()));
        }
    }

    Ok(None)
}