use anyhow::Result;
use serenity::prelude::*;
use serenity::model::prelude::*;
use std::sync::Arc;
use crate::database::DbPool;

#[derive(Debug, Clone)]
pub struct GameState {
    pub game_id: i64,
    pub guild_id: u64,
    pub status: GameStatus,
    pub players: Vec<Player>,
    pub day_phase: bool,
    pub day_number: i32,
}

#[derive(Debug, Clone)]
pub enum GameStatus {
    Setup,
    Signup,
    Active,
    Ended,
}

#[derive(Debug, Clone)]
pub struct Player {
    pub user_id: u64,
    pub role_id: Option<i32>,
    pub is_alive: bool,
    pub votes_for: Option<u64>,
}

pub struct WerewolfBot {
    pub pool: Arc<DbPool>,
    pub openai_client: Option<async_openai::Client<async_openai::config::OpenAIConfig>>,
}

impl WerewolfBot {
    pub fn new(pool: Arc<DbPool>) -> Self {
        let openai_client = std::env::var("OPENAI_API_KEY")
            .ok()
            .map(|key| async_openai::Client::with_config(
                async_openai::config::OpenAIConfig::new().with_api_key(key)
            ));

        Self {
            pool,
            openai_client,
        }
    }

    pub async fn has_moderator_permissions(&self, ctx: &Context, member: &Member) -> bool {
        member.permissions(ctx).await
            .map(|perms| perms.administrator() || perms.manage_guild())
            .unwrap_or(false)
    }

    pub async fn get_active_game(&self, guild_id: u64) -> Result<Option<GameState>> {
        let client = self.pool.get().await?;
        let rows = client
            .query(
                "SELECT game_id, guild_id, status, day_phase, day_number FROM games 
                 WHERE guild_id = $1 AND status IN ('setup', 'signup', 'active')",
                &[&(guild_id as i64)],
            )
            .await?;

        if let Some(row) = rows.first() {
            let game_id: i64 = row.get("game_id");
            let status_str: &str = row.get("status");
            let status = match status_str {
                "setup" => GameStatus::Setup,
                "signup" => GameStatus::Signup,
                "active" => GameStatus::Active,
                "ended" => GameStatus::Ended,
                _ => GameStatus::Setup,
            };

            let players = self.get_game_players(game_id).await?;

            Ok(Some(GameState {
                game_id,
                guild_id,
                status,
                players,
                day_phase: row.get("day_phase"),
                day_number: row.get("day_number"),
            }))
        } else {
            Ok(None)
        }
    }

    async fn get_game_players(&self, game_id: i64) -> Result<Vec<Player>> {
        let client = self.pool.get().await?;
        let rows = client
            .query(
                "SELECT user_id, role_id, is_alive, votes_for FROM game_players 
                 WHERE game_id = $1",
                &[&game_id],
            )
            .await?;

        Ok(rows
            .into_iter()
            .map(|row| Player {
                user_id: row.get::<_, i64>("user_id") as u64,
                role_id: row.get("role_id"),
                is_alive: row.get("is_alive"),
                votes_for: row.get::<_, Option<i64>>("votes_for").map(|v| v as u64),
            })
            .collect())
    }

    pub async fn generate_funny_response(&self, command: &str, username: &str) -> Option<String> {
        let client = self.openai_client.as_ref()?;

        let prompt = format!(
            "You are a Discord bot for a Werewolf (mafia) game. A user tried to use an unknown command: \"{}\". 
            Generate a funny, short response (1-2 sentences max) that:
            - Is playful and slightly sarcastic
            - Is a possible response to the command
            - Keeps the tone light and entertaining
            - Doesn't exceed 2 sentences
            - Crass and vulgar language is allowed

            Do not allude to the fact that the command is unknown.",
            command
        );

        let request = async_openai::types::CreateChatCompletionRequestArgs::default()
            .model("gpt-3.5-turbo")
            .messages([
                async_openai::types::ChatCompletionRequestSystemMessageArgs::default()
                    .content("You are a sassy Discord bot that responds to unknown commands with short, funny messages that could be a possible response to the command.")
                    .build()?
                    .into(),
                async_openai::types::ChatCompletionRequestUserMessageArgs::default()
                    .content(prompt)
                    .build()?
                    .into(),
            ])
            .max_tokens(100u16)
            .temperature(0.8)
            .build()
            .ok()?;

        match client.chat().completions().create(request).await {
            Ok(response) => {
                let content = response.choices.first()?.message.content.as_ref()?;
                let cleaned = content.trim()
                    .trim_matches('"')
                    .trim_matches('"')
                    .trim_matches('\'')
                    .trim_matches('\'');
                Some(cleaned.to_string())
            }
            Err(e) => {
                tracing::error!("OpenAI error: {}", e);
                None
            }
        }
    }
}