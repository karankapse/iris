# Handy shortcuts. Run `make help` to list them.
.PHONY: help setup dev dev-frontend dev-backend lint test format gen-types

help:            ## Show this help
	@grep -E '^[a-z-]+:.*##' Makefile | sed 's/:.*##/ -/'

setup:           ## Install frontend + backend dependencies and create .env
	cd frontend && npm install && npm run setup:mediapipe
	cd backend && uv sync
	@test -f .env || (cp .env.example .env && echo "created .env (fill in ANTHROPIC_API_KEY for real suggestions)")

dev:             ## Start backend AND frontend together (Ctrl+C stops both)
	$(MAKE) -j2 dev-backend dev-frontend

dev-frontend:    ## Start the web app on http://localhost:5173
	cd frontend && npm run dev

dev-backend:     ## Start the API on http://localhost:8000
	cd backend && uv run uvicorn app.main:app --reload --port 8000

lint:            ## Lint + format check, both sides
	cd frontend && npm run lint && npm run format:check && npm run typecheck
	cd backend && uv run ruff check . && uv run ruff format --check .

format:          ## Auto-format both sides
	cd frontend && npm run format
	cd backend && uv run ruff format . && uv run ruff check --fix .

test:            ## Run all tests
	cd frontend && npm test
	cd backend && uv run pytest

gen-types:       ## Regenerate frontend API types from the backend's Pydantic models
	cd backend && uv run python -m scripts.export_openapi
	cd frontend && npm run gen:types
