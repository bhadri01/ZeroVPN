use zerovpn_db::PgPool;

pub struct AppState {
    pub pool: PgPool,
}
