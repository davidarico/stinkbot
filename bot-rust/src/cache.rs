use moka::future::Cache;
use std::time::Duration;
use crate::werewolf::GameState;

#[derive(Clone)]
pub struct GameCache {
    games: Cache<u64, GameState>,
    server_configs: Cache<u64, ServerConfig>,
}

#[derive(Debug, Clone)]
pub struct ServerConfig {
    pub guild_id: u64,
    pub prefix: String,
    pub starting_number: i32,
}

impl GameCache {
    pub fn new() -> Self {
        Self {
            games: Cache::builder()
                .max_capacity(1000)
                .time_to_live(Duration::from_secs(300)) // 5 minutes TTL
                .build(),
            server_configs: Cache::builder()
                .max_capacity(10000)
                .time_to_live(Duration::from_secs(1800)) // 30 minutes TTL
                .build(),
        }
    }

    pub async fn get_game(&self, guild_id: u64) -> Option<GameState> {
        self.games.get(&guild_id).await
    }

    pub async fn set_game(&self, guild_id: u64, game: GameState) {
        self.games.insert(guild_id, game).await;
    }

    pub async fn invalidate_game(&self, guild_id: u64) {
        self.games.invalidate(&guild_id).await;
    }

    pub async fn get_server_config(&self, guild_id: u64) -> Option<ServerConfig> {
        self.server_configs.get(&guild_id).await
    }

    pub async fn set_server_config(&self, guild_id: u64, config: ServerConfig) {
        self.server_configs.insert(guild_id, config).await;
    }
}