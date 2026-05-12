-- Migration 7: optional server-side storage of a device's WG private key.
--
-- Default behaviour (and the historical guarantee) is that the private
-- key never leaves the create-device response — the user saves it
-- locally. This column relaxes that for users who explicitly opt in at
-- create time: when populated, the API can re-render the .conf later
-- without rotating keys, which is convenient for users who track
-- everything about a device server-side.
--
-- The column is BYTEA holding the AES-256-GCM ciphertext + nonce
-- produced by the same `Kek` we already use for preshared_key_encrypted
-- — never a plaintext private key. Rotating ZEROVPN_KEK without a
-- re-encrypt migration will make these unreadable, same caveat as the
-- existing PSK column.

-- `IF NOT EXISTS` so the migration is safe to re-apply when sqlx asks us
-- to refresh a stale checksum (the column itself only ever gets added once).
ALTER TABLE devices
    ADD COLUMN IF NOT EXISTS private_key_encrypted BYTEA;
