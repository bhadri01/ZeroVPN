use std::net::IpAddr;

use ipnetwork::IpNetwork;
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[serde(rename_all = "snake_case")]
#[sqlx(type_name = "user_role", rename_all = "snake_case")]
pub enum UserRole {
    Admin,
    User,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[serde(rename_all = "snake_case")]
#[sqlx(type_name = "user_status", rename_all = "snake_case")]
pub enum UserStatus {
    Active,
    Suspended,
    PendingVerification,
    Deleted,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[serde(rename_all = "snake_case")]
#[sqlx(type_name = "device_status", rename_all = "snake_case")]
pub enum DeviceStatus {
    Active,
    Paused,
    Revoked,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[serde(rename_all = "snake_case")]
#[sqlx(type_name = "device_os", rename_all = "snake_case")]
pub enum DeviceOs {
    Ios,
    Android,
    Macos,
    Windows,
    Linux,
    Other,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct User {
    pub id: Uuid,
    pub email: String,
    pub role: UserRole,
    pub status: UserStatus,
    pub must_change_password: bool,
    pub email_verified_at: Option<OffsetDateTime>,
    pub totp_enabled: bool,
    pub created_at: OffsetDateTime,
    pub last_login_at: Option<OffsetDateTime>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Server {
    pub id: Uuid,
    pub name: String,
    pub region: String,
    pub endpoint_host: String,
    pub endpoint_port: i32,
    pub public_key: String,
    pub cidr: IpNetwork,
    pub dns_servers: Vec<IpNetwork>,
    pub mtu: i32,
    pub is_active: bool,
}

impl Server {
    pub fn dns_servers_ips(&self) -> Vec<IpAddr> {
        self.dns_servers.iter().map(|n| n.ip()).collect()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Device {
    pub id: Uuid,
    pub user_id: Uuid,
    pub server_id: Uuid,
    pub name: String,
    pub os: DeviceOs,
    pub public_key: String,
    pub allocated_ip: IpNetwork,
    pub status: DeviceStatus,
    pub dns_names: Vec<String>,
    pub allowed_ips_override: Option<Vec<String>>,
    pub dns_override: Option<Vec<IpNetwork>>,
    pub last_handshake_at: Option<OffsetDateTime>,
    pub created_at: OffsetDateTime,
}

impl Device {
    pub fn dns_override_ips(&self) -> Option<Vec<IpAddr>> {
        self.dns_override.as_ref().map(|v| v.iter().map(|n| n.ip()).collect())
    }
}
