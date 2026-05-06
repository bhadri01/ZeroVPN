use anyhow::Result;
use clap::{Parser, Subcommand};
use tracing_subscriber::{EnvFilter, fmt, prelude::*};

#[derive(Parser)]
#[command(name = "zerovpn-cli", version, about = "ZeroVPN admin CLI")]
struct Cli {
    #[command(subcommand)]
    command: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    /// Run pending DB migrations
    Migrate,
    /// Bootstrap the very first admin user (interactive password prompt)
    BootstrapAdmin {
        #[arg(long)]
        email: String,
    },
    /// Rotate the WireGuard server keypair (DESTRUCTIVE: invalidates all peer configs)
    RotateServerKeys,
    /// Print current version
    Version,
}

#[tokio::main]
async fn main() -> Result<()> {
    let _ = dotenvy::dotenv();
    init_tracing();
    let cli = Cli::parse();
    match cli.command {
        Cmd::Migrate => migrate().await,
        Cmd::BootstrapAdmin { email } => bootstrap_admin(email).await,
        Cmd::RotateServerKeys => rotate_server_keys().await,
        Cmd::Version => {
            println!("zerovpn-cli {}", env!("CARGO_PKG_VERSION"));
            Ok(())
        }
    }
}

fn init_tracing() {
    let filter = EnvFilter::try_from_env("RUST_LOG")
        .unwrap_or_else(|_| EnvFilter::new("info"));
    tracing_subscriber::registry()
        .with(filter)
        .with(fmt::layer().compact())
        .init();
}

async fn migrate() -> Result<()> {
    let database_url = std::env::var("ZEROVPN_DATABASE_URL")?;
    let pool = zerovpn_db::init_pool(&database_url, 4).await?;
    zerovpn_db::run_migrations(&pool).await?;
    println!("migrations applied");
    Ok(())
}

async fn bootstrap_admin(email: String) -> Result<()> {
    let database_url = std::env::var("ZEROVPN_DATABASE_URL")?;
    let pool = zerovpn_db::init_pool(&database_url, 2).await?;
    let password = inquire::Password::new("Initial admin password (will require change on first login):")
        .with_display_mode(inquire::PasswordDisplayMode::Masked)
        .with_help_message("min 12 chars")
        .prompt()?;
    if password.len() < 12 {
        anyhow::bail!("password too short");
    }
    let hash = zerovpn_auth::password::hash(&password)?;
    let id = uuid::Uuid::now_v7();
    sqlx::query(
        r#"INSERT INTO users (id, email, password_hash, role, status, must_change_password)
           VALUES ($1, $2, $3, 'admin', 'active', TRUE)
           ON CONFLICT (email) DO NOTHING"#,
    )
    .bind(id)
    .bind(email.to_lowercase())
    .bind(hash)
    .execute(&pool)
    .await?;
    println!("admin bootstrapped: {email}");
    Ok(())
}

async fn rotate_server_keys() -> Result<()> {
    eprintln!("not yet implemented");
    Ok(())
}

