# Generative AI Platform for Film & Television Production

This repository is a production-oriented starter for a generative-AI platform built for film and television production workflows.

It includes:

- Express API with PostgreSQL persistence
- JWT-based auth with role-based access control (writer, director, producer, admin)
- Redis-backed job queue for long-running generation work
- Python FastAPI ML orchestration service with OpenAI-ready integration
- Worker service for async generation jobs
- Prompt template library and approval workflow
- Audit logging for prompts, jobs, and approvals
- Minimal dashboard for projects, jobs, templates, and approvals
- Docker Compose stack for PostgreSQL, Redis, MinIO, backend, worker, ML service, and frontend

## Architecture

- Frontend: dashboard for projects, jobs, approvals, and templates
- Backend: REST API and orchestration logic
- Queue: Redis + Bull for generation jobs
- Worker: dispatches queued jobs to the ML service
- ML service: generation logic for scripts, storyboards, and shotlists
- Storage: MinIO-ready for generated assets and renders
- Database: PostgreSQL for projects, scenes, jobs, templates, approvals, and audit logs

## Requirements

- Docker + Docker Compose
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

3. Open:

- Frontend: http://localhost:3000
- Backend API: http://localhost:4000
- ML docs: http://localhost:8000/docs
- MinIO console: http://localhost:9001

## Demo auth

```bash
curl -X POST http://localhost:4000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@studio.local","name":"Admin User","role":"admin"}'
```

Available demo roles:

- writer
- director
- producer
- admin

## Core features

- Projects and scenes
- Prompt templates and variable-driven generation flows
- Job queue with async processing
- Human approval state transitions per job
- Audit log tracking for all actions
- Role-protected endpoints

## Workflow example

Create a project:

```bash
curl -X POST http://localhost:4000/api/projects \
  -H 'Authorization: Bearer <jwt>' \
  -H 'Content-Type: application/json' \
  -d '{"title":"Project Atlas","description":"A rainy urban thriller."}'
```

Create a scene:

```bash
curl -X POST http://localhost:4000/api/projects/<project-id>/scenes \
  -H 'Authorization: Bearer <jwt>' \
  -H 'Content-Type: application/json' \
  -d '{
    "title":"Night exterior chase",
    "brief":"A tense night chase through a wet city block.",
    "tasks":["script","storyboard","shotlist"]
  }'
```

Approve a job:

```bash
curl -X POST http://localhost:4000/api/jobs/<job-id>/approve \
  -H 'Authorization: Bearer <jwt>' \
  -H 'Content-Type: application/json' \
  -d '{"status":"approved","comment":"This matches the board-approved interpretation."}'
```

## Database schema

See `db/schema.sql` for the PostgreSQL schema.

## Production notes

For production, extend this with:

- model registry and prompt versioning
- RBAC per-project permissions
- moderation pipeline
- real asset storage and transcode pipeline
- advanced approval workflows and notifications
- analytics and billing
- deployment automation and observability

## License

MIT
