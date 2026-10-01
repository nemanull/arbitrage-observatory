  use sqlx::PgPool;
  use sqlx::postgres::PgPoolOptions;

  pub async fn connect(url: &str) -> anyhow::Result<PgPool> {
      let pool = PgPoolOptions::new()
            .max_connections(2)   // the writer, plus a spare for a boot-time or status query
            .min_connections(1)   // if the connection dies, reopen it in the background
            .idle_timeout(None)   // never close it for being quiet
            .max_lifetime(None)   // never recycle it for being old
            .connect(url)
            .await?;
      Ok(pool)
  }




