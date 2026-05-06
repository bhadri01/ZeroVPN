# Runbook

## First-time setup

1. Clone the repo, then `make setup`. This:
   - Copies `.env.example` to `.env`.
   - Generates random secrets via `scripts/init-secrets.sh` (KEK, session secret, DB password, Redis password) into `./secrets/`.
   - Builds the Docker images.
2. `make up` starts the stack.
3. `make migrate` applies pending migrations.
4. `make bootstrap-admin EMAIL=admin@example.com` creates the first admin user. The CLI prompts for an initial password (≥12 chars). The user is flagged `must_change_password=TRUE` and will be required to set a new password on first login.

## Healthchecks

- API `GET /health` — liveness.
- API `GET /ready` — db reachability.
- Caddy `GET /healthz` — proxy responsive.

## Common issues

| Symptom | Likely cause | Fix |
|---|---|---|
| `api` exits with `database connection refused` | DB not yet ready | `docker compose logs db`; usually self-resolves once `pg_isready` succeeds |
| Frontend shows "API unreachable" | api container down or Caddy upstream unhealthy | `docker compose ps`, then `docker compose logs api` |
| `wg show` empty | WG container needs NET_ADMIN | check container caps; on macOS Docker Desktop the WG container runs userspace via `amneziawg-go` which is fine for dev |
| `zmq publisher bind` fails | port 5555 already used | other compose project running; `docker compose down` first |

## Backup & restore

(Phase 1C deliverable. Backup container with age encryption + offsite push.)

## Rotating secrets

```
docker compose down
rm secrets/*.txt
./scripts/init-secrets.sh    # regenerates with new values; updates .env
docker compose up -d
```

> **Caution:** rotating the session secret invalidates all live sessions; users must log in again. Rotating the KEK breaks any AES-GCM-encrypted column unless you re-encrypt first.

## Upgrading

1. `git pull`
2. `make check` — runs cargo check + clippy + tsc + eslint
3. `docker compose build`
4. `make migrate`
5. `make up`
