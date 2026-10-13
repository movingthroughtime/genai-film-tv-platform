# Generative AI Platform for Film & Television Production

This repository is a starter monorepo for a generative-AI platform tailored to film and television production. It includes:

- Express API with Postgres-backed project, scene, and job persistence
- JWT-based demo auth and role checks
- Redis-backed job queue for async generation tasks
- Python FastAPI ML microservice with OpenAI integration fallback
- Worker service that processes generation jobs
- Minimal front-end dashboard for project and job management
- Docker Compose stack with Postgres, Redis, MinIO, backend, worker, ML service, and frontend

## Architecture

- Frontend: project and job dashboard UI
- Backend: REST API and orchestration
- Queue: Redis + Bull for background jobs
- Worker: dispatches jobs to the ML service
- ML service: script/storyboard/shotlist generation with an OpenAI fallback for local dev
- Storage: MinIO-ready for generated assets
- Database: PostgreSQL for project-scoped persistence

## Requirements

- Docker and Docker Compose
- Node.js 20+
- Python 3.12+
- OpenAI API key (optional for local dev fallback)

## Quick start

1. Copy environment variables:

```bash
cp .env.example .env
```

2. Start the stack:

```bash
docker compose up --build
```

3. Open the app:

- Frontend: http://localhost:3000
- Backend API: http://localhost:4000
- ML service docs: http://localhost:8000/docs
- MinIO console: http://localhost:9001

## Auth

Use the demo login endpoint:

```bash
curl -X POST http://localhost:4000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"demo@studio.local","name":"Demo User"}'
```

Use the returned JWT as a bearer token for protected routes.

## Example API requests

Create a project:

```bash
curl -X POST http://localhost:4000/api/projects \
  -H 'Authorization: Bearer <jwt>' \
  -H 'Content-Type: application/json' \
  -d '{"title":"Project Atlas","description":"A rainy urban thriller."}'
```

Create a scene and queue generation tasks:

```bash
curl -X POST http://localhost:4000/api/projects/<project-id>/scenes \
  -H 'Authorization: Bearer <jwt>' \
  -H 'Content-Type: application/json' \
  -d '{
    "title": "Night exterior chase",
    "brief": "A tense night chase through a wet city block.",
    "tasks": ["script", "storyboard", "shotlist"]
  }'
```

Check a job:

```bash
curl http://localhost:4000/api/jobs/<job-id>
```

## Database schema

See `db/schema.sql` for the PostgreSQL schema.

## Production notes

This MVP includes:

- JWT auth skeleton
- Postgres-backed persistence
- Redis queue
- MinIO-compatible asset strategy
- Basic moderation / logging hooks
- Real OpenAI call integration when configured

For production, add:

- RBAC with roles (writer, director, producer, admin)
- Abstract model registry and prompt templates
- Human-in-the-loop approvals
- Policy screening for generated output
- Asset versioning, thumbnails, and transcodes
- Observability and billing

## License

MIT
