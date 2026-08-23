-- ====================================================================
-- CampusAttend — Scalable Staff Face Database Schema
--
-- Supports 100+, 500+, 1000+ staff members without schema changes.
-- Face embeddings are stored as 128-dimensional floating point vectors
-- corresponding to the face-api.js ResNet-34 biometric model.
-- ====================================================================

-- 1. Enable required extensions (pgcrypto for UUIDs, vector for pgvector similarity)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. Staff Table
CREATE TABLE IF NOT EXISTS staff (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_code VARCHAR(64) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  department VARCHAR(255) NOT NULL,
  designation VARCHAR(255) NOT NULL,
  active BOOLEAN DEFAULT true NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- 3. Face Embeddings Table (1 staff -> many face embeddings)
CREATE TABLE IF NOT EXISTS face_embeddings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id UUID NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  embedding vector(512) NOT NULL,
  reference_image_path TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- 4. Indexes for high-performance lookups & scalable vector search
CREATE INDEX IF NOT EXISTS idx_staff_staff_code ON staff(staff_code);
CREATE INDEX IF NOT EXISTS idx_staff_active ON staff(active);
CREATE INDEX IF NOT EXISTS idx_face_embeddings_staff_id ON face_embeddings(staff_id);

-- 5. pgvector index for fast Approximate Nearest Neighbor (ANN) L2 search
-- (Recommended for >1000 embeddings using IVFFlat or HNSW)
-- CREATE INDEX IF NOT EXISTS idx_face_embeddings_vector_l2 ON face_embeddings USING ivfflat (embedding vector_l2_ops) WITH (lists = 100);
