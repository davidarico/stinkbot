use serenity::framework::standard::macros::group;

pub mod ping;
pub mod game;
pub mod player;

use ping::*;
use game::*;
use player::*;

#[group]
#[commands(ping)]
pub struct General;

#[group]
#[commands(setup, create, start, end, refresh, alive, help)]
pub struct Game;

#[group] 
#[commands(join_game, leave, vote, retract)]
pub struct Player;

