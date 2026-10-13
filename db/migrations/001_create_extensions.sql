-- 001_create_extensions.sql
-- Enable pgcrypto for gen_random_uuid and pgvector for vector embeddings

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;
