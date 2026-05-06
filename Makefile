SHELL := /bin/bash
.DEFAULT_GOAL := help

COMPOSE := docker compose
COMPOSE_DEV := $(COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml

.PHONY: help
help: ## Show this help
	@awk 'BEGIN {FS = ":.*##"; printf "\nUsage: make \033[36m<target>\033[0m\n\nTargets:\n"} /^[a-zA-Z_-]+:.*?##/ {printf "  \033[36m%-22s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

.PHONY: setup
setup: ## One-time: copy .env, generate secrets, build images
	@if [ ! -f .env ]; then cp .env.example .env && echo "Created .env from example."; fi
	@./scripts/init-secrets.sh
	$(COMPOSE_DEV) build

.PHONY: up
up: ## Start the dev stack
	$(COMPOSE_DEV) up -d

.PHONY: up-prod
up-prod: ## Start the prod stack
	$(COMPOSE) up -d

.PHONY: down
down: ## Stop the stack
	$(COMPOSE_DEV) down

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
test: ## Run all tests
	cargo test --workspace
	cd web && pnpm test

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
	@echo "This will destroy all data. Press Ctrl+C to abort, Enter to continue."
	@read _
	$(COMPOSE_DEV) down -v
	cargo clean
	rm -rf web/node_modules web/dist
	rm -rf web/src/wasm/{wire,topology}/*.{wasm,js,d.ts}
