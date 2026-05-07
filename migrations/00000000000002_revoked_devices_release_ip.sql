-- Allow IP recycling after a device is revoked.
--
-- The original unique constraint covered all rows including revoked, which
-- meant a freed-then-reallocated IP from a previous user collided with the
-- old (revoked) row. Replace with a partial unique index so only active and
-- paused devices contend for IPs.

ALTER TABLE devices DROP CONSTRAINT IF EXISTS devices_server_id_allocated_ip_key;

CREATE UNIQUE INDEX IF NOT EXISTS devices_server_id_allocated_ip_uniq_active
    ON devices (server_id, allocated_ip)
    WHERE status <> 'revoked';
