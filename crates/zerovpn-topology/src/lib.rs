//! Force-directed graph layout, exported to WASM for the admin scale view.
//!
//! Phase 1B/1C: implement a barebones Barnes-Hut + spring simulation that
//! returns x/y per node. Activated on the frontend when peer count > 200.

#[cfg(feature = "wasm")]
#[wasm_bindgen::prelude::wasm_bindgen]
pub fn version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}
