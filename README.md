# Generative AI Platform for Film & Television Production

This repository contains a starter monorepo for a generative-AI platform tailored to film and television production. It includes:

- Express backend API for projects, scenes, and jobs
- BullMQ-style Redis job queue for async generation
- Python FastAPI microservice for ML generation orchestration
- Worker service that processes queued tasks
- Static frontend for creating scenes and monitoring job status
- Docker Compose setup for local development

## Architecture

- Frontend: quick UI for submitting scene generation requests
- Backend: project/scene/job management API
- Queue: Redis handling for long-running AI tasks
- Worker: dispatches work to the ML service
- ML service: LLM and generation orchestration layer
- Storage: ready for S3/MinIO integration for generated assets

## Requirements

- Docker + Docker Compose
- Node.js 20+
- Python 3.12+

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
   - ML service: http://localhost:8000/docs

## Example API requests

Create a scene and enqueue generation jobs:

```bash
curl -X POST http://localhost:4000/api/projects/film-project-001/scenes \
  -H 'Content-Type: application/json' \
  -d '{
    "title": "Night exterior chase",
    "brief": "A tense night chase through a wet city block.",
    "tasks": ["script", "storyboard", "shotlist"]
  }'
```

Check job status:

```bash
curl http://localhost:4000/api/jobs/<job-id>
```

## Components

### Backend
Located in `backend/`. Handles project/scene creation and job submission.

### Worker
Located in `worker/`. Pulls queued generation jobs and calls the ML service.

### ML Service
Located in `ml_service/`. Runs generation logic for scripts, storyboards, and shotlists.

### Frontend
Located in `frontend/`. A minimal UI for submitting new scene requests and polling job state.

## Production notes

This starter is intentionally simple and should be extended with:

- Postgres persistence and migrations
- S3/MinIO asset uploads
- Content moderation and policy checks
- Human approval workflows
- Model registry and version tracking
- Queue retry, backoff, and observability

## License

MIT
