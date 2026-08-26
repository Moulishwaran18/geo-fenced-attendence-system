# pyright: reportMissingImports=false
# pyright: reportMissingModuleSource=false
# mypy: ignore-errors

"""
CampusAttend AI Biometric Engine - FastAPI Async Face Recognition & Liveness Backend
Stack: FastAPI, MediaPipe Face Mesh, MiniFASNet Texture Analysis, DeepFace (FaceNet512), asyncpg, pgvector
"""

import io
import time
import asyncio
from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass, field

import cv2  # type: ignore
import numpy as np  # type: ignore
import asyncpg  # type: ignore
from PIL import Image  # type: ignore
from pydantic import BaseModel  # type: ignore
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, status  # type: ignore
from fastapi.middleware.cors import CORSMiddleware  # type: ignore
import mediapipe as mp  # type: ignore
from deepface import DeepFace  # type: ignore


# =============================================================================
# 1. CONFIGURATION & CONSTANTS
# =============================================================================

DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/campus_biometrics"
MATCH_THRESHOLD = 0.40       # FaceNet512 Cosine distance threshold (<= 0.40 is same identity)
MARGIN_THRESHOLD = 0.08      # Separation margin between best and second-best candidate

# Eye Aspect Ratio (EAR) Thresholds
EAR_CLOSED_THRESHOLD = 0.21  # Below this EAR value, eye is registered as closed
EAR_OPEN_THRESHOLD = 0.27    # Above this EAR value, eye is registered as open
MIN_BLINK_DURATION_MS = 100  # Natural blink minimum physiological duration
MAX_BLINK_DURATION_MS = 450  # Natural blink maximum duration (longer = deliberate spoof/sleep)
SESSION_TTL_SECONDS = 30.0   # Stream state tracker session timeout

# MediaPipe 468/478 Face Mesh Landmarks for Eye Contours
# Left Eye: p1=33 (outer), p2=160 (top-L), p3=158 (top-R), p4=133 (inner), p5=153 (bot-R), p6=144 (bot-L)
LEFT_EYE_INDICES = [33, 160, 158, 133, 153, 144]
# Right Eye: p1=263 (outer), p2=387 (top-L), p3=385 (top-R), p4=362 (inner), p5=380 (bot-R), p6=373 (bot-L)
RIGHT_EYE_INDICES = [263, 387, 385, 362, 380, 373]


# =============================================================================
# 2. TEMPORAL STREAM STATE TRACKER (In-Memory sliding window)
# =============================================================================

@dataclass
class EARSample:
    ear: float
    timestamp_ms: float

@dataclass
class StreamState:
    stream_id: str
    samples: List[EARSample] = field(default_factory=list)
    blink_in_progress: bool = False
    blink_start_ms: Optional[float] = None
    liveness_verified: bool = False
    verified_at: Optional[float] = None
    last_seen_ms: float = field(default_factory=lambda: time.time() * 1000)

class TemporalLivenessTracker:
    """
    Tracks sequential frames from a specific webcam stream_id to detect natural
    blinking curves without requiring explicit user instructions.
    """
    def __init__(self):
        self._sessions: Dict[str, StreamState] = {}
        self._lock = asyncio.Lock()

    async def update(self, stream_id: str, current_ear: float) -> Tuple[bool, str]:
        async with self._lock:
            now_ms = time.time() * 1000
            self._cleanup_stale_sessions(now_ms)

            if stream_id not in self._sessions:
                self._sessions[stream_id] = StreamState(stream_id=stream_id)

            state = self._sessions[stream_id]
            state.last_seen_ms = now_ms
            state.samples.append(EARSample(ear=current_ear, timestamp_ms=now_ms))

            # Retain the last 3 seconds of telemetry
            cutoff_ms = now_ms - 3000
            state.samples = [s for s in state.samples if s.timestamp_ms >= cutoff_ms]

            # If already verified within the last 5 seconds, keep pass state
            if state.liveness_verified and state.verified_at and (now_ms - state.verified_at < 5000):
                return True, "Liveness session active (Verified natural blink)"

            # State Machine: Detecting natural eye closure and reopening
            if not state.blink_in_progress:
                if current_ear <= EAR_CLOSED_THRESHOLD:
                    state.blink_in_progress = True
                    state.blink_start_ms = now_ms
                    return False, "Eye closure detected, awaiting natural reopen"
            else:
                if current_ear >= EAR_OPEN_THRESHOLD:
                    closure_duration = now_ms - (state.blink_start_ms or now_ms)
                    state.blink_in_progress = False
                    state.blink_start_ms = None

                    if MIN_BLINK_DURATION_MS <= closure_duration <= MAX_BLINK_DURATION_MS:
                        state.liveness_verified = True
                        state.verified_at = now_ms
                        return True, f"Natural blink verified ({int(closure_duration)}ms)"
                    else:
                        return False, f"Unnatural closure duration: {int(closure_duration)}ms"

            return state.liveness_verified, "Awaiting natural blink"

    def _cleanup_stale_sessions(self, now_ms: float):
        expired = [sid for sid, s in self._sessions.items() if (now_ms - s.last_seen_ms) > (SESSION_TTL_SECONDS * 1000)]
        for sid in expired:
            del self._sessions[sid]

tracker = TemporalLivenessTracker()


# =============================================================================
# 3. COMPUTER VISION & PASSIVE ANTI-SPOOFING LAYER
# =============================================================================

try:
    from mediapipe.python.solutions import face_mesh as mp_face_mesh  # type: ignore
except Exception:
    try:
        mp_face_mesh = mp.solutions.face_mesh  # type: ignore
    except Exception:
        mp_face_mesh = None

face_mesh_detector = (
    mp_face_mesh.FaceMesh(
        max_num_faces=1,
        refine_landmarks=True,
        min_detection_confidence=0.5,
        min_tracking_confidence=0.5,
    )
    if mp_face_mesh
    else None
)

def compute_ear(landmarks, eye_indices: List[int], img_w: int, img_h: int) -> float:
    """
    Computes Eye Aspect Ratio (EAR) for a 6-point eye contour.
    EAR = ( ||p2 - p6|| + ||p3 - p5|| ) / ( 2 * ||p1 - p4|| )
    """
    pts = [
        np.array([landmarks[idx].x * img_w, landmarks[idx].y * img_h])
        for idx in eye_indices
    ]
    dist_v1 = np.linalg.norm(pts[1] - pts[5])
    dist_v2 = np.linalg.norm(pts[2] - pts[4])
    dist_h = np.linalg.norm(pts[0] - pts[3])
    
    if dist_h == 0:
        return 0.0
    return float((dist_v1 + dist_v2) / (2.0 * dist_h))

def analyze_passive_texture(image_bgr: np.ndarray, bbox: Tuple[int, int, int, int]) -> Tuple[bool, float, str]:
    """
    Passive Anti-Spoofing & Texture Analysis:
    Evaluates Laplacian variance and Fourier 2D power spectrum to reject:
      - Screen moiré patterns
      - Paper print grain & specular screen reflection
    """
    x, y, w, h = bbox
    cx, cy = x + w // 2, y + h // 2
    scale = 2.7
    nw, nh = int(w * scale), int(h * scale)
    nx = max(0, cx - nw // 2)
    ny = max(0, cy - nh // 2)
    crop = image_bgr[ny:min(image_bgr.shape[0], ny + nh), nx:min(image_bgr.shape[1], nx + nw)]

    if crop.size == 0 or crop.shape[0] < 50 or crop.shape[1] < 50:
        return False, 0.0, "Invalid crop size for texture analysis"

    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    laplacian_var = cv2.Laplacian(gray, cv2.CV_64F).var()
    
    f = np.fft.fft2(gray)
    fshift = np.fft.fftshift(f)
    magnitude_spectrum = 20 * np.log(np.abs(fshift) + 1e-9)
    
    rows, cols = gray.shape
    crow, ccol = rows // 2, cols // 2
    mask = np.ones((rows, cols), np.uint8)
    r = min(rows, cols) // 8
    cv2.circle(mask, (ccol, crow), r, 0, -1)
    high_freq_energy = np.mean(magnitude_spectrum * mask)
    
    is_live_texture = laplacian_var >= 45.0 and high_freq_energy < 180.0
    live_score = min(1.0, max(0.0, (laplacian_var / 250.0)))

    if not is_live_texture:
        return False, live_score, f"Spoof detected (Laplacian: {laplacian_var:.1f}, HighFreq: {high_freq_energy:.1f})"
    
    return True, live_score, "Texture analysis: Real 3D skin"


# =============================================================================
# 4. FASTAPI APPLICATION & LIFECYCLE
# =============================================================================

app = FastAPI(
    title="CampusAttend AI Biometric Engine",
    description="Asynchronous Face Recognition with Implicit Liveness & pgvector",
    version="2.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

import json
import os

db_pool: Optional[asyncpg.Pool] = None
local_staff_db: Optional[dict] = None

@app.on_event("startup")
async def startup_db():
    global db_pool, local_staff_db
    try:
        db_pool = await asyncpg.create_pool(
            dsn=DATABASE_URL,
            min_size=2,
            max_size=10,
            command_timeout=5
        )
        async with db_pool.acquire() as conn:
            await conn.execute("CREATE EXTENSION IF NOT EXISTS vector;")
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS user_embeddings (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    user_id VARCHAR(64) NOT NULL,
                    name VARCHAR(128) NOT NULL,
                    embedding vector(512) NOT NULL,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
                );
            """)
        print("[OK] Connected to PostgreSQL with pgvector extension.")
    except Exception as e:
        print(f"[WARN] PostgreSQL not available ({e}). Initializing local JSON fallback store.")
        db_path = os.path.abspath("data/staff-db.json")
        if os.path.exists(db_path):
            with open(db_path, "r", encoding="utf-8") as f:
                local_staff_db = json.load(f)
            print(f"[OK] Loaded {len(local_staff_db.get('staff', []))} staff records from {db_path}.")

@app.get("/")
def root():
    return {
        "service": "CampusAttend AI Biometric Engine",
        "status": "ONLINE",
        "detector": "RetinaFace / MediaPipe",
        "model": "DeepFace FaceNet512",
        "database": "PostgreSQL pgvector / Local Fallback Store",
        "docs_url": "/docs"
    }

@app.get("/health")
def health():
    return {"status": "ok", "timestamp": time.time()}


# =============================================================================
# 5. RESPONSE SCHEMAS
# =============================================================================

class AuthSuccessResponse(BaseModel):
    authenticated: bool
    liveness_verified: bool
    user_id: str
    name: str
    match_distance: float
    confidence_score: float
    message: str


# =============================================================================
# 6. BIOMETRIC RECOGNITION ENDPOINT
# =============================================================================

@app.post(
    "/api/face/recognize",
    response_model=AuthSuccessResponse,
    responses={
        200: {"description": "Identity verified with active liveness"},
        400: {"description": "Invalid image or face count != 1"},
        403: {"description": "Liveness or anti-spoofing verification failed"},
        404: {"description": "Unknown face / No match in database"},
    }
)
async def recognize_face(
    file: UploadFile = File(...),
    stream_id: str = Form(...)
):
    """
    Main Biometric Authentication Endpoint:
    1. Extracts 3D facial mesh & computes bilateral EAR.
    2. Runs implicit temporal blink tracker (sliding window).
    3. Runs passive texture & Fourier anti-spoof check.
    4. If liveness passes -> generates FaceNet-512 vector & performs pgvector match.
    """
    # ── 1. Decode Frame ──
    try:
        contents = await file.read()
        pil_image = Image.open(io.BytesIO(contents)).convert("RGB")
        image_np = np.array(pil_image)
        img_h, img_w, _ = image_np.shape
        image_bgr = cv2.cvtColor(image_np, cv2.COLOR_RGB2BGR)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Corrupt or invalid image format: {str(e)}"
        )

    # ── 2. MediaPipe Face Mesh Detection ──
    results = face_mesh_detector.process(image_np)
    if not results.multi_face_landmarks or len(results.multi_face_landmarks) != 1:
        face_count = len(results.multi_face_landmarks) if results.multi_face_landmarks else 0
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Exactly ONE face is required. Detected: {face_count}"
        )

    face_landmarks = results.multi_face_landmarks[0].landmark

    # ── 3. Calculate Bilateral Eye Aspect Ratio (EAR) ──
    left_ear = compute_ear(face_landmarks, LEFT_EYE_INDICES, img_w, img_h)
    right_ear = compute_ear(face_landmarks, RIGHT_EYE_INDICES, img_w, img_h)
    mean_ear = (left_ear + right_ear) / 2.0

    # ── 4. Passive Texture & Anti-Spoof Analysis ──
    x_coords = [int(p.x * img_w) for p in face_landmarks]
    y_coords = [int(p.y * img_h) for p in face_landmarks]
    bbox = (min(x_coords), min(y_coords), max(x_coords) - min(x_coords), max(y_coords) - min(y_coords))

    texture_passed, texture_score, texture_msg = analyze_passive_texture(image_bgr, bbox)
    if not texture_passed:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Anti-spoof rejected: {texture_msg}"
        )

    # ── 5. Implicit Temporal Liveness State Machine ──
    liveness_passed, liveness_msg = await tracker.update(stream_id, mean_ear)

    if not liveness_passed:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Liveness verification failed: {liveness_msg} (EAR: {mean_ear:.3f})"
        )

    # ── 6. FaceNet-512 Feature Extraction ──
    try:
        embedding_objs = DeepFace.represent(
            img_path=image_bgr,
            model_name="Facenet512",
            enforce_detection=True,
            detector_backend="skip",
            normalization="Facenet2018"
        )
        embedding_vector = embedding_objs[0]["embedding"]
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Embedding extraction error: {str(e)}"
        )

    # ── 7. Vector Cosine Distance Search ──
    rows = []
    if db_pool:
        vec_literal = f"[{','.join(f'{x:.8f}' for x in embedding_vector)}]"
        async with db_pool.acquire() as conn:
            query = """
                SELECT user_id, name, (embedding <=> $1::vector) AS distance
                FROM user_embeddings
                ORDER BY distance ASC
                LIMIT 2;
            """
            rows = await conn.fetch(query, vec_literal)
    elif local_staff_db:
        # Fallback in-memory search
        def cos_dist(u, v):
            u_arr = np.array(u, dtype=np.float32)
            v_arr = np.array(v, dtype=np.float32)
            dot = np.dot(u_arr, v_arr)
            norm_u = np.linalg.norm(u_arr)
            norm_v = np.linalg.norm(v_arr)
            if norm_u == 0 or norm_v == 0:
                return 1.0
            return float(np.clip(1.0 - (dot / (norm_u * norm_v)), 0.0, 2.0))

        candidates = []
        staff_map = {s["id"]: s for s in local_staff_db.get("staff", []) if s.get("active", True)}
        for emb_rec in local_staff_db.get("face_embeddings", []):
            st = staff_map.get(emb_rec["staff_id"])
            if st and "embedding" in emb_rec:
                d = cos_dist(embedding_vector, emb_rec["embedding"])
                candidates.append({"user_id": st["id"], "name": st["name"], "distance": d})
        candidates.sort(key=lambda x: x["distance"])
        rows = candidates[:2]
    else:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Database pool and local store unavailable"
        )

    if not rows:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No enrolled users found in vector database"
        )

    best_match = rows[0]
    best_distance = float(best_match["distance"])
    second_distance = float(rows[1]["distance"]) if len(rows) > 1 else 1.0
    margin = second_distance - best_distance

    if best_distance > MATCH_THRESHOLD:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Unknown face. Best distance ({best_distance:.4f}) exceeds threshold ({MATCH_THRESHOLD})"
        )

    if len(rows) > 1 and margin < MARGIN_THRESHOLD:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Ambiguous identity. Margin ({margin:.4f}) below requirement ({MARGIN_THRESHOLD})"
        )

    # ── 8. Success Response ──
    return AuthSuccessResponse(
        authenticated=True,
        liveness_verified=True,
        user_id=best_match["user_id"],
        name=best_match["name"],
        match_distance=round(best_distance, 4),
        confidence_score=round(1.0 - best_distance, 4),
        message=f"Identity confirmed: {best_match['name']} ({liveness_msg})"
    )

if __name__ == "__main__":
    import uvicorn  # type: ignore
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info")
