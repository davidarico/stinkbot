use deadpool_postgres::{Config, Pool, Runtime};
use tokio_postgres::NoTls;
use std::env;

pub type DbPool = Pool;

pub fn init_pool() -> Result<DbPool, Box<dyn std::error::Error>> {
    let mut cfg = Config::new();
    let pg_url = env::var("DATABASE_URL").expect("DATABASE_URL must be set");
    cfg.url = Some(pg_url);
    let pool = cfg.create_pool(Some(Runtime::Tokio1), NoTls)?;
    Ok(pool)
}
