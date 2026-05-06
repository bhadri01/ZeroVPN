use std::path::PathBuf;

use figment::{
    Figment,
    providers::{Env, Format, Toml},
};
use serde::Deserialize;

use crate::error::{Error, Result};

#[derive(Debug, Clone, Deserialize)]
pub struct Config {
    pub environment: Environment,
    pub bind_address: String,
    pub database_url: String,
    pub redis_url: String,
    pub session_secret: String,
    pub kek: String,
    pub smtp: SmtpConfig,
    pub wg: WgConfig,
    pub events: EventsConfig,
    pub log_level: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Environment {
    Dev,
    Staging,
    Production,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SmtpConfig {
    pub host: String,
    pub port: u16,
    pub username: Option<String>,
    pub password: Option<String>,
    pub from: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct WgConfig {
    pub interface: String,
    pub server_endpoint: String,
    pub listen_port: u16,
    pub control_socket: PathBuf,
    pub dnsmasq_hosts_file: PathBuf,
}

#[derive(Debug, Clone, Deserialize)]
pub struct EventsConfig {
    pub publisher_bind: String,
    pub subscriber_connect: String,
}

impl Config {
    pub fn load() -> Result<Self> {
        let figment = Figment::new()
            .merge(Toml::file("config.toml").nested())
            .merge(Env::prefixed("ZEROVPN_").split("__"));

        figment
            .extract::<Config>()
            .map_err(|e| Error::Internal(format!("config: {e}")))
    }
}
