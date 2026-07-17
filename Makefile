SHELL := /bin/bash
.DEFAULT_GOAL := help

# Single-file compose layout. Per-environment values (domain, TLS,
# SMTP host, WG backend, logging) live in `.env`; optional service groups
# are gated by compose profiles.
COMPOSE     := docker compose
COMPOSE_DEV := $(COMPOSE) --profile dev
# Dev *containers*: run api/worker/web in Linux with hot-reload + a real
# (userspace) WireGuard tunnel. The overlay gates the prod api/worker/frontend/
# traefik behind the `prod` profile so only the *-dev services run.
COMPOSE_DEVCTR := $(COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml --profile dev

.PHONY: help
help: ## Show this help
	@awk 'BEGIN {FS = ":.*##"; printf "\nUsage: make \033[36m<target>\033[0m\n\nTargets:\n"} /^[a-zA-Z_-]+:.*?##/ {printf "  \033[36m%-22s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

.PHONY: setup
setup: ## One-time: copy .env template, generate secrets, build images
	@if [ ! -f .env ]; then \
		cp .env.example .env; \
		echo "Created .env from .env.example."; \
		echo ""; \
		echo "*** For production, edit .env now:"; \
		echo "***   - ZEROVPN_ENVIRONMENT=production"; \
		echo "***   - ZEROVPN_DOMAIN, ZEROVPN_PUBLIC_URL, ZEROVPN_ACME_EMAIL"; \
		echo "***   - ZEROVPN_CERT_RESOLVER=le"; \
		echo "***   - ZEROVPN_SMTP__HOST (real relay, not mailhog)"; \
		echo "***   - ZEROVPN_WG__BACKEND=kernel"; \
		echo ""; \
	fi
	@./scripts/init-secrets.sh
	$(COMPOSE_DEV) build

.PHONY: up
up: ## Start the dev stack (core + MailHog)
	$(COMPOSE_DEV) up -d

.PHONY: up-prod
up-prod: ## Start the prod stack (core only — no MailHog; uses real SMTP from .env)
	$(COMPOSE) up -d

.PHONY: down
down: ## Stop the stack
	$(COMPOSE_DEV) down

# ── Dev containers (api + worker + web in Linux, real WireGuard) ─────────────
.PHONY: up-dev
up-dev: ## Dev containers: run api/worker/web in Linux with hot-reload + real WG
	LAN_IP="$$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo 127.0.0.1)" \
		$(COMPOSE_DEVCTR) up -d --build
	@echo ""
	@echo "Dev containers up (first build/compile takes a few minutes — watch logs):"
	@echo "  Web (Vite)   http://localhost:6173"
	@echo "  API (debug)  http://localhost:18080"
	@echo "  WireGuard    udp/51820 on this host's LAN IP"
	@echo "  Logs:        make logs-dev"

.PHONY: down-dev
down-dev: ## Stop the dev containers
	$(COMPOSE_DEVCTR) down

.PHONY: logs-dev
logs-dev: ## Tail dev-container logs
	$(COMPOSE_DEVCTR) logs -f --tail=120

# ── Native dev loop ─────────────────────────────────────────────────────────
# Run db/redis/dnsmasq/mailhog in docker, but run api/worker/frontend
# natively for fast iteration (cargo incremental, Vite HMR). The api +
# worker container slots are kept stopped so they don't fight for ports.

DEV_INFRA := db redis dnsmasq mailhog

.PHONY: dev
dev: ## Native dev: start infra in docker, leave api/worker/frontend for cargo + pnpm
	$(COMPOSE_DEV) up -d $(DEV_INFRA)
	$(COMPOSE_DEV) stop api worker frontend traefik 2>/dev/null || true
	@echo ""
	@echo "Infra up. In separate terminals run:"
	@echo "  make dev-api      # native zerovpn-api on http://localhost:8080"
	@echo "  make dev-worker   # native zerovpn-worker on tcp://localhost:5555"
	@echo "  make dev-web      # Vite HMR on http://localhost:6173"

.PHONY: dev-api
dev-api: ## Run the api natively against the dockerized infra
	./scripts/dev-native.sh cargo run -p zerovpn-api

.PHONY: dev-worker
dev-worker: ## Run the worker natively against the dockerized infra
	./scripts/dev-native.sh cargo run -p zerovpn-worker

.PHONY: dev-web
dev-web: ## Vite dev server with HMR (proxies /api + /ws to localhost:8080)
	cd web && pnpm dev

.PHONY: dev-migrate
dev-migrate: ## Run migrations against the dockerized db from the host
	./scripts/dev-native.sh cargo run -p zerovpn-cli -- migrate

.PHONY: dev-bootstrap-admin
dev-bootstrap-admin: ## Bootstrap admin natively. EMAIL=admin@example.com required
	@if [ -z "$(EMAIL)" ]; then echo "Usage: make dev-bootstrap-admin EMAIL=admin@example.com" && exit 1; fi
	./scripts/dev-native.sh cargo run -p zerovpn-cli -- bootstrap-admin --email $(EMAIL)

.PHONY: dev-down
dev-down: ## Stop the dev infra containers (api/worker/frontend you stop manually)
	$(COMPOSE_DEV) stop $(DEV_INFRA)

.PHONY: logs
logs: ## Tail logs
	$(COMPOSE_DEV) logs -f --tail=100

.PHONY: ps
ps: ## List containers
	$(COMPOSE_DEV) ps

.PHONY: migrate
migrate: ## Run pending migrations
	$(COMPOSE_DEV) exec api zerovpn-cli migrate

.PHONY: bootstrap-admin
bootstrap-admin: ## Create the first admin user. EMAIL=admin@example.com required
	@if [ -z "$(EMAIL)" ]; then echo "Usage: make bootstrap-admin EMAIL=admin@example.com" && exit 1; fi
	$(COMPOSE_DEV) exec api zerovpn-cli bootstrap-admin --email $(EMAIL)

.PHONY: shell-api
shell-api: ## Open a shell in the api container
	$(COMPOSE_DEV) exec api sh

.PHONY: shell-db
shell-db: ## Open a psql shell
	$(COMPOSE_DEV) exec db psql -U zerovpn -d zerovpn

.PHONY: test
test: ## Run all unit/workspace tests
	cargo test --workspace

.PHONY: test-it
test-it: ## Run DB integration tests (separate crate; needs Docker)
	cd tests && cargo test

.PHONY: smoke
smoke: ## Run end-to-end smoke test against the running stack
	./scripts/smoke-test.sh

.PHONY: check
check: ## cargo check + clippy + tsc + eslint
	cargo check --workspace --all-targets
	cargo clippy --workspace --all-targets -- -D warnings
	cd web && pnpm tsc --noEmit && pnpm lint

.PHONY: fmt
fmt: ## Format code
	cargo fmt --all
	cd web && pnpm format

.PHONY: sqlx-prepare
sqlx-prepare: ## Regenerate .sqlx offline query data
	cd crates/zerovpn-db && cargo sqlx prepare -- --tests

.PHONY: clean
clean: ## DESTRUCTIVE: stop and remove all containers, volumes, build artifacts
	@echo "This will destroy all data in the stack. Press Ctrl+C to abort, Enter to continue."
	@read _
	$(COMPOSE_DEV) down -v
	cargo clean
	rm -rf web/node_modules web/dist
