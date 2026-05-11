SHELL := /bin/bash
.DEFAULT_GOAL := help

# Stack selection. Override with `make <target> ENV=prod` or use the
# `*-prod` aliases below. Each environment has its own .env file
# (.env.dev / .env.prod) and its own secrets/ subdir.
ENV ?= dev
ifeq ($(ENV),prod)
  ENV_FILE := .env.prod
  COMPOSE  := docker compose -f docker-compose.yml -f docker-compose.prod.yml
else ifeq ($(ENV),dev)
  ENV_FILE := .env.dev
  COMPOSE  := docker compose -f docker-compose.yml -f docker-compose.dev.yml
else
  $(error ENV must be 'dev' or 'prod', got '$(ENV)')
endif

# `compose --env-file` makes the file's vars available to compose itself for
# `${VAR}` substitution (e.g. ZEROVPN_DOMAIN in the prod Caddyfile is read
# from the env into the caddy container via the service-level env_file too,
# but the substitution layer needs it visible here as well).
COMPOSE_E := $(COMPOSE) --env-file $(ENV_FILE)

.PHONY: help
help: ## Show this help
	@awk 'BEGIN {FS = ":.*##"; printf "\nUsage: make \033[36m<target>\033[0m [ENV=dev|prod]\n\nTargets:\n"} /^[a-zA-Z_-]+:.*?##/ {printf "  \033[36m%-22s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

.PHONY: setup
setup: ## One-time: copy env template, generate secrets, build images (ENV=dev|prod)
	@if [ ! -f $(ENV_FILE) ]; then \
		cp .env.$(ENV).example $(ENV_FILE); \
		echo "Created $(ENV_FILE) from .env.$(ENV).example."; \
		if [ "$(ENV)" = "prod" ]; then \
			echo ""; \
			echo "*** Edit $(ENV_FILE) to fill in REPLACE_WITH_* placeholders"; \
			echo "*** before continuing (ZEROVPN_DOMAIN, SMTP relay, etc.)."; \
		fi; \
	fi
	@./scripts/init-secrets.sh $(ENV)
	$(COMPOSE_E) build

.PHONY: setup-prod
setup-prod: ## Alias for `make setup ENV=prod`
	$(MAKE) setup ENV=prod

.PHONY: up
up: ## Start the stack (ENV=dev|prod)
	$(COMPOSE_E) up -d

.PHONY: up-prod
up-prod: ## Alias for `make up ENV=prod`
	$(MAKE) up ENV=prod

.PHONY: down
down: ## Stop the stack
	$(COMPOSE_E) down

# ── Native dev loop ─────────────────────────────────────────────────────────
# Run db/redis/dnsmasq/mailhog in docker, but run api/worker/frontend
# natively for fast iteration (cargo incremental, Vite HMR). The api +
# worker container slots from docker-compose.dev.yml are kept stopped so
# they don't fight for ports.

# Services that stay in docker even during native dev.
DEV_INFRA := db redis dnsmasq mailhog

.PHONY: dev
dev: ## Native dev: start infra in docker, leave api/worker/frontend for cargo + pnpm
	$(COMPOSE_E) up -d $(DEV_INFRA)
	$(COMPOSE_E) stop api worker frontend caddy 2>/dev/null || true
	@echo ""
	@echo "Infra up. In separate terminals run:"
	@echo "  make dev-api      # native zerovpn-api on http://localhost:8080"
	@echo "  make dev-worker   # native zerovpn-worker on tcp://localhost:5555"
	@echo "  make dev-web      # Vite HMR on http://localhost:5173"

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
	$(COMPOSE_E) stop $(DEV_INFRA)

.PHONY: logs
logs: ## Tail logs
	$(COMPOSE_E) logs -f --tail=100

.PHONY: ps
ps: ## List containers
	$(COMPOSE_E) ps

.PHONY: migrate
migrate: ## Run pending migrations
	$(COMPOSE_E) exec api zerovpn-cli migrate

.PHONY: bootstrap-admin
bootstrap-admin: ## Create the first admin user. EMAIL=admin@example.com required
	@if [ -z "$(EMAIL)" ]; then echo "Usage: make bootstrap-admin EMAIL=admin@example.com" && exit 1; fi
	$(COMPOSE_E) exec api zerovpn-cli bootstrap-admin --email $(EMAIL)

.PHONY: shell-api
shell-api: ## Open a shell in the api container
	$(COMPOSE_E) exec api sh

.PHONY: shell-db
shell-db: ## Open a psql shell
	$(COMPOSE_E) exec db psql -U zerovpn -d zerovpn

.PHONY: test
test: ## Run all tests
	cargo test --workspace

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

.PHONY: wasm-build
wasm-build: ## Build WASM artifacts for the frontend
	wasm-pack build crates/zerovpn-wire --target web --release --out-dir ../../web/src/wasm/wire
	wasm-pack build crates/zerovpn-topology --target web --release --out-dir ../../web/src/wasm/topology

.PHONY: clean
clean: ## DESTRUCTIVE: stop and remove all containers, volumes, build artifacts
	@echo "This will destroy all data in the $(ENV) stack. Press Ctrl+C to abort, Enter to continue."
	@read _
	$(COMPOSE_E) down -v
	cargo clean
	rm -rf web/node_modules web/dist
	rm -rf web/src/wasm/{wire,topology}/*.{wasm,js,d.ts}
