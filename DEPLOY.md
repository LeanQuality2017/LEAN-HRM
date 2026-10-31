# UniHR — Production Deployment Runbook

## 1. Prerequisites
- Docker Engine 24+ and Docker Compose v2+
- External reverse proxy (Nginx / Caddy / Cloudflare) terminating TLS and forwarding to port 3000

## 2. Environment Configuration
Create `.env` adjacent to `docker-compose.yml`:

| Variable | Description | Example / Requirement |
| :--- | :--- | :--- |
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://unihr:unihr@db:5432/unihr?schema=public` |
| `connection_limit` | In production, remove =3 and size connection_limit for the target instance (10–20 on a small VPS) | Append `&connection_limit=15` to `DATABASE_URL` |
| `NEXTAUTH_URL` | Canonical app URL (HTTPS in prod) | `https://hrm.example.com` |
| `NEXTAUTH_SECRET` | 32+ char random secret for JWTs | `openssl rand -base64 32` |
| `BIOMETRIC_API_KEY` | Hex API key for machine sync | `openssl rand -hex 32` |

## 3. Deployment Commands
```bash
docker compose up -d db migrate app                    # Boot DB, run migrations, start app
docker compose run --rm migrate npx tsx prisma/seed.ts # Optional demo dataset seed
```

## 4. Health & Status Check
```bash
docker compose ps
curl -fsS http://127.0.0.1:3000/api/health || exit 1
```

## 5. Database Backup & Restore
```bash
docker exec -t unihr-db pg_dump -U unihr -d unihr | gzip > unihr_$(date +%Y%m%d_%H%M%S).sql.gz
gunzip < unihr_backup.sql.gz | docker exec -i unihr-db psql -U unihr -d unihr
```

## 6. FIRST DEPLOY VALIDATION
```bash
docker compose build
docker compose up -d db migrate app
docker compose ps                          # app healthy, migrate exited 0
curl -s localhost:3000/api/health          # {"ok":true}
docker compose exec app whoami             # must NOT be root
docker compose exec app sh -c 'ls -a /app | grep .env || echo "no env files: OK"'
Browser: login -> /profile -> employees -> payslip print; zero CSP console errors; PWA installable.
```
