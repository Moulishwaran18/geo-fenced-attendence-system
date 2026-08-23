# Scalable Staff Face Database & Biometric Enrollment System

This document describes the PostgreSQL database architecture, vector search engine, and admin-controlled biometric enrollment system implemented in **CampusAttend**.

---

## 1. PostgreSQL Database Schema & Architecture

The database is built on a scalable relational schema with **pgvector** support, engineered to support **100+, 500+, 1000+** staff members without schema changes.

```
┌──────────────────────────────────────────────────────────┐
│                          STAFF                           │
├──────────────────────────────────────────────────────────┤
│ id (UUID, PK)                                            │
│ staff_code (VARCHAR 64, UNIQUE, e.g. "PERSON_001")       │
│ name (VARCHAR 255)                                       │
│ email (VARCHAR 255, UNIQUE)                              │
│ department (VARCHAR 255)                                 │
│ designation (VARCHAR 255)                                │
│ active (BOOLEAN)                                         │
│ created_at (TIMESTAMPTZ)                                 │
│ updated_at (TIMESTAMPTZ)                                 │
└────────────────────────────┬─────────────────────────────┘
                             │
                             │ 1-to-Many
                             ▼
┌──────────────────────────────────────────────────────────┐
│                     FACE_EMBEDDINGS                      │
├──────────────────────────────────────────────────────────┤
│ id (UUID, PK)                                            │
│ staff_id (UUID, FK -> staff.id ON DELETE CASCADE)        │
│ embedding (VECTOR(128), 128-float biometric descriptor)  │
│ reference_image_path (TEXT)                              │
│ created_at (TIMESTAMPTZ)                                 │
└──────────────────────────────────────────────────────────┘
```

### Table Definitions (DDL)

```sql
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS vector;

-- 1. Staff Table
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

-- 2. Face Embeddings Table
CREATE TABLE IF NOT EXISTS face_embeddings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id UUID NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  embedding vector(128) NOT NULL,
  reference_image_path TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- 3. High-Performance Indexes
CREATE INDEX IF NOT EXISTS idx_staff_staff_code ON staff(staff_code);
CREATE INDEX IF NOT EXISTS idx_staff_active ON staff(active);
CREATE INDEX IF NOT EXISTS idx_face_embeddings_staff_id ON face_embeddings(staff_id);

-- 4. Vector Similarity Index (Recommended for >1000 embeddings)
-- CREATE INDEX IF NOT EXISTS idx_face_embeddings_vector_l2 ON face_embeddings USING ivfflat (embedding vector_l2_ops) WITH (lists = 100);
```

---

## 2. One-to-Many Relationship & Multi-Embedding Representation

Biometric face matching in real-world conditions requires multi-sample representations. Instead of a single reference photo, each staff member stores multiple 128-dimensional face embeddings covering:
- Frontal view
- Left and right head turns (yaw angle variation)
- Slight upward/downward tilts (pitch angle variation)
- Diverse indoor and outdoor lighting
- Normal facial expression variations

Each uploaded photo generates a 128-dimensional float descriptor linked to the selected staff member. **Uploading a photo never creates a new staff identity.**

---

## 3. Initial 3 Test Users & Existing Photo Import

The database initializes with exactly 3 test staff records:

| Staff Code | Full Name | Department | Designation | Email |
| :--- | :--- | :--- | :--- | :--- |
| `PERSON_001` | Test Person 1 | Computer Science & Engineering | Associate Professor | `test.person1@sonatech.ac.in` |
| `PERSON_002` | Test Person 2 | Information Technology | Assistant Professor | `test.person2@sonatech.ac.in` |
| `PERSON_003` | Test Person 3 | Electronics & Communication | Professor | `test.person3@sonatech.ac.in` |

### Existing Photo Discovery & Seeding Pipeline

The seeding command (`npm run db:seed`) automatically locates and processes the existing reference photos in the workspace:
1. **PERSON_001**: Scans `public/staff-photos/person-001/` (`reference_01.jpg` – `reference_05.jpg`).
2. **PERSON_002**: Scans `public/staff-photos/person-002/` (`reference_01.jpg` – `reference_05.jpg`).
3. **PERSON_003**: Scans `public/staff-photos/person-003/` (`reference_01.jpg` – `reference_05.jpg`).

For each image:
- Runs SSD MobileNet V1 face detector.
- Validates **exactly one face** is in view (rejects 0 or multiple faces).
- Computes 128-dimensional biometric descriptor with ResNet-34.
- Persists embedding into `face_embeddings` table linked to the staff record.
- Prevents duplicates on repeated script executions.

---

## 4. How Future 100+ Staff are Enrolled

The database and admin enrollment console support unlimited staff growth (`PERSON_004`, `PERSON_005`, ..., `PERSON_100+`):

1. **Create Staff**: Admin navigates to `/admin/staff` and clicks **Add Staff**. Enter Staff Code, Full Name, Email, Department, and Designation.
2. **Enroll Photos**: Select the staff member in `/admin/face-enrollment`.
3. **Select / Upload Images**:
   - Drag-and-drop or multi-select any photos from disk (no folder structure required).
   - Or click **Snap Camera Photo** to capture live reference snapshots directly.
4. **Validation & Storage**:
   - System analyzes each photo in the batch.
   - Enforces single-face presence and image quality.
   - Extracts 128-d descriptors and persists to backend PostgreSQL `face_embeddings`.
   - Staff member is automatically marked **Active**.

---

## 5. Vector Search Architecture & Matching Engine

Face matching is executed through backend vector similarity queries:

```sql
SELECT 
  s.id AS staff_id,
  s.staff_code,
  s.name,
  f.id AS embedding_id,
  (f.embedding <-> $1::vector) AS distance
FROM face_embeddings f
JOIN staff s ON f.staff_id = s.id
WHERE s.active = true
ORDER BY distance ASC
LIMIT 5;
```

### Matching Thresholds
- **Distance Metric**: Euclidean L2 Distance (`<->`).
- **Face Match Threshold**: `< 0.58` Euclidean distance (calibrated for live webcam lighting variations).
- **Minimum Separation Margin**: `>= 0.05` separation between best candidate and second-best candidate from a different staff member to prevent false cross-identifications.

---

## 6. Unknown Person Handling & Rejection

If a live face scan fails to meet the similarity threshold (`distance >= 0.58`) against all active authorized staff embeddings:
- The system returns `matched: false` with reason: `"Face Not Recognized. Only authorized staff members can mark attendance."`
- **Zero Database Writes**: Unknown faces are **never** auto-enrolled, saved, or assigned to a nearest match.
- Normal staff users cannot self-enroll.

---

## 7. Biometric Data Security & Privacy Controls

1. **No Raw Embedding Exposure**: Backend API responses (`GET /api/admin/staff`, `GET /api/admin/staff/:id`) omit raw 128-float arrays. Only sample counts and metadata are sent.
2. **Backend-Isolated Search**: The full biometric database is never downloaded to the client browser. Live matching sends only the live face descriptor to `POST /api/face/verify`.
3. **Credential Isolation**: Database credentials are read from environment variables (`DATABASE_URL`, `PGHOST`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`).
4. **Role Separation**: Face enrollment endpoints (`/api/admin/staff/*`) are restricted to administrators.

---

## 8. Reproducible Setup & Testing Guide

### Database Migration & Seeding Commands
```bash
# 1. Run migrations to create schema and tables
npm run db:migrate

# 2. Run seed script to import existing photos for PERSON_001, PERSON_002, PERSON_003
npm run db:seed
```

### Verification & Testing Flow
1. **Admin Staff Console (`/admin/staff`)**:
   - Verify `PERSON_001`, `PERSON_002`, `PERSON_003` appear with `Enrolled (5 samples)` status.
   - Click **Add Staff** to add `PERSON_004` (Test Person 4).
2. **Face Enrollment Console (`/admin/face-enrollment`)**:
   - Select `PERSON_004`.
   - Upload reference photos or capture webcam snaps.
   - View stored reference gallery with delete options.
   - Use the **Biometric Vector Search Tester** to test matching any photo against the database.
3. **Live Attendance Verification (`/mark-attendance`)**:
   - Open face scan dialog.
   - Complete single eye blink liveness check.
   - Verify live face matches the corresponding authorized staff record.
   - Test non-authorized person to confirm rejection.
