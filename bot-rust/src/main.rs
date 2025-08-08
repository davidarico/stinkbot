use std::env;
use serenity::async_trait;
use serenity::prelude::*;
use serenity::model::gateway::Ready;
use serenity::model::prelude::*;

mod commands;
mod database;
mod werewolf;
mod cache;
mod message_handler;

use database::DbPool;
use message_handler::MessageHandler;
use std::sync::Arc;

struct DbPoolKey;

impl TypeMapKey for DbPoolKey {
    type Value = Arc<DbPool>;
}

struct Handler {
    message_handler: MessageHandler,
}

impl Handler {
    fn new() -> Self {
        Self {
            message_handler: MessageHandler::new(),
        }
    }
}

#[async_trait]
impl EventHandler for Handler {
    async fn ready(&self, _: Context, ready: Ready) {
        tracing::info!("{} is connected and ready! 🐺", ready.user.name);
    }

    async fn message(&self, ctx: Context, msg: Message) {
        if let Err(why) = self.message_handler.handle_message(&ctx, &msg).await {
            tracing::error!("Error handling message: {:?}", why);
        }
    }
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();
    dotenv::dotenv().expect("Failed to load .env file");
    
    tracing::info!("Starting werewolf bot...");
    
    let token = env::var("DISCORD_TOKEN").expect("Expected a token in the environment");

    let intents = GatewayIntents::GUILD_MESSAGES
        | GatewayIntents::DIRECT_MESSAGES
        | GatewayIntents::MESSAGE_CONTENT
        | GatewayIntents::GUILDS
        | GatewayIntents::GUILD_MEMBERS
        | GatewayIntents::GUILD_MESSAGE_REACTIONS;

    let mut client = Client::builder(&token, intents)
        .event_handler(Handler::new())
        .await
        .expect("Error creating client");

    let pool = Arc::new(database::init_pool().expect("Failed to create database pool"));

    {
        let mut data = client.data.write().await;
        data.insert::<DbPoolKey>(pool);
    }

    if let Err(why) = client.start().await {
        println!("Client error: {:?}", why);
    }
}
