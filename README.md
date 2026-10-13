# Generative AI Platform for Film & Television Production

A production-oriented starter for a generative-AI platform built to support film and television development workflows.

This repo now includes:

- Express API with PostgreSQL persistence
- JWT auth with role-based access control (writer, director, producer, admin)
- Redis-backed job queues for long-running generation jobs
- Python FastAPI ML service with OpenAI-ready generation integration
- Worker service to process generation tasks asynchronously
- Prompt template library and approval workflow
- Audit logging for user actions and studio operations
- Dashboard for projects, jobs, templates, and approvals
- Docker Compose stack for backend, worker, ML service, Postgres, Redis, and MinIO

## Features

- Project creation and scene-based workflows
- Multi-task generation jobs (script, storyboard, shotlist)
- Access control by role
- Prompt templates for reusable production prompts
- Approval states to review generation outputs
- Audit logs for governance and traceability
- Storage-ready design for generated media assets

## Architecture

- Frontend: studio dashboard UI
- Backend: REST API and orchestration
- Queue: Redis + Bull for background tasks
- Worker: dispatches jobs to the ML service
- ML service: generation logic for script/storyboard/shotlist content
- Storage: MinIO-ready asset storage pattern
- Database: PostgreSQL for projects, scenes, jobs, templates, approvals, and logs

## Requirements

- Docker + Docker Compose
- Node.js 20+
- Python 3.12+
- OpenAI API key (optional; local fallback works without it)

## Quick start

1. Copy the environment file:

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
- ML docs: http://localhost:8000/docs
- MinIO console: http://localhost:9001

## Demo auth

```bash
curl -X POST http://localhost:4000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@studio.local","name":"Admin User","role":"admin"}'
```

Built-in roles:

- writer
- director
- producer
- admin

## Typical workflow

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
    "title": "Night exterior chase",
    "brief": "A tense chase through a wet city block.",
    "tasks": ["script", "storyboard", "shotlist"]
  }'
```

Approve a job:

```bash
curl -X POST http://localhost:4000/api/jobs/<job-id>/approve \
  -H 'Authorization: Bearer <jwt>' \
  -H 'Content-Type: application/json' \
  -d '{"status":"approved","comment":"Matches the board-approved direction."}'
```

## Database schema

See `db/schema.sql` for the PostgreSQL schema.

## Production notes

This starter is designed to be extended with:

- model registry and prompt versioning
- stricter per-project permissions
- moderation pipeline and content screening
- real asset lifecycle management
- render/transcode orchestration
- observability and billing metrics

## License

MIT
