use askama::Template;

/// Renders a peer-side `wg-quick` config with optional AmneziaWG params.
#[derive(Template)]
#[template(
    source = r#"[Interface]
PrivateKey = {{ private_key }}
Address = {{ address }}
DNS = {{ dns }}{% if mtu.is_some() %}
MTU = {{ mtu.unwrap() }}{% endif %}{% if let Some(awg) = amnezia %}
Jc = {{ awg.jc }}
Jmin = {{ awg.jmin }}
Jmax = {{ awg.jmax }}
S1 = {{ awg.s1 }}
S2 = {{ awg.s2 }}
H1 = {{ awg.h1 }}
H2 = {{ awg.h2 }}
H3 = {{ awg.h3 }}
H4 = {{ awg.h4 }}{% endif %}

[Peer]
PublicKey = {{ server_public_key }}{% if let Some(psk) = preshared_key %}
PresharedKey = {{ psk }}{% endif %}
AllowedIPs = {{ allowed_ips }}
Endpoint = {{ endpoint }}
PersistentKeepalive = {{ keepalive }}
"#,
    ext = "txt",
    escape = "none"
)]
pub struct PeerConfig<'a> {
    pub private_key: &'a str,
    pub address: &'a str,
    pub dns: &'a str,
    pub mtu: Option<u16>,
    pub amnezia: Option<AmneziaParams>,
    pub server_public_key: &'a str,
    pub preshared_key: Option<&'a str>,
    pub allowed_ips: &'a str,
    pub endpoint: &'a str,
    pub keepalive: u16,
}

#[derive(Debug, Clone, Copy)]
pub struct AmneziaParams {
    pub jc: u8,
    pub jmin: u16,
    pub jmax: u16,
    pub s1: u16,
    pub s2: u16,
    pub h1: u32,
    pub h2: u32,
    pub h3: u32,
    pub h4: u32,
}
