# Plant Stimulant Use Survey — KMTC Nakuru

Node + Express + PostgreSQL. Runs on port 3004, tunneled by Cloudflare.

## First-time setup

    cp .env.example .env
    # edit .env — strong passwords, 64-char SESSION_SECRET
    openssl rand -hex 32   # generate SESSION_SECRET

## Start

    docker compose up -d --build
    docker compose logs -f app

## Verify

    curl -s http://127.0.0.1:3004/health    | jq
    curl -s http://127.0.0.1:3004/db-check  | jq

## Cloudflare Tunnel

Add an ingress rule pointing your subdomain at the loopback address:

    survey.yourdomain.com  →  http://localhost:3004

The app binds to 127.0.0.1 only — Cloudflare is the sole public entry point.

## Common commands

    docker compose logs -f app           # tail app logs
    docker compose logs -f db            # tail db logs
    docker compose restart app           # restart app only
    docker compose down                  # stop (keeps data)
    docker compose down -v               # stop + WIPE ALL DATA

## Postgres access

    docker exec -it survey_db psql -U survey -d survey