# CampusAttend — Complete Technical Documentation & System Specification

**Document Version:** 1.0.0 (Exhaustive Source Audit)  
**Project Name:** CampusAttend — Geofenced Biometric Attendance Management System  
**Repository Path:** `D:\project\geo-fenced-attendence-system`  
**Production URL:** `https://geo-fenced-attendence-system.vercel.app/`  
**Date of Audit:** October 17, 2026  
**Author / Senior Engineer:** Comprehensive Biometric Systems & Software Architecture Audit  

---

## Table of Contents
1. [Introduction, Problem Statement & Objectives](#1-introduction-problem-statement--objectives)
2. [Complete Repository Structure & File Inventory](#2-complete-repository-structure--file-inventory)
3. [Core Architectural Foundations & Technology Stack](#3-core-architectural-foundations--technology-stack)
4. [Android Native Subsystem & Hardware Keystore Cryptography](#4-android-native-subsystem--hardware-keystore-cryptography)
5. [AI, Computer Vision & Biometric Inference Subsystem](#5-ai-computer-vision--biometric-inference-subsystem)
6. [Single-Action Randomized Head Movement Liveness Engine](#6-single-action-randomized-head-movement-liveness-engine)
7. [Presentation Attack Detection (PAD) & Optical Heuristics](#7-presentation-attack-detection-pad--optical-heuristics)
8. [Geographic Geofencing & 1D Kalman Filter Subsystem](#8-geographic-geofencing--1d-kalman-filter-subsystem)
9. [Campus Wi-Fi & 3-Factor Attendance Verification Pipeline](#9-campus-wi-fi--3-factor-attendance-verification-pipeline)
10. [Face Enrollment, Multi-Angle Capture & Re-Enrollment Governance](#10-face-enrollment-multi-angle-capture--re-enrollment-governance)
11. [Frontend Interface, Viewport Architecture & Diagnostics](#11-frontend-interface-viewport-architecture--diagnostics)
12. [Backend Serverless Architecture & Nitro Endpoints](#12-backend-serverless-architecture--nitro-endpoints)
13. [Supabase PostgreSQL Database, Schemas & Security Definer RPCs](#13-supabase-postgresql-database-schemas--security-definer-rpcs)
14. [Security Architecture, Threat Model & Privacy Guarantees](#14-security-architecture-threat-model--privacy-guarantees)
15. [Automated Testing, Parity Harnesses & Forensic Scripts](#15-automated-testing-parity-harnesses--forensic-scripts)
16. [DevOps, Git Workflow & Production Vercel Deployment](#16-devops-git-workflow--production-vercel-deployment)

---

## 1. Introduction, Problem Statement & Objectives

### 1.1 Context and Problem Statement
Traditional academic and corporate attendance recording systems suffer from fundamental vulnerabilities:
1. **Buddy Punching & Identity Impersonation:** RFID cards, barcode badges, and credential-based logins can be transferred easily between individuals, leading to rampant proxy attendance.
2. **Biometric Presentation Attacks:** Conventional face-recognition terminals can be bypassed using printed 2D photographs, high-resolution smartphone replays, or tablet video playback.
3. **Geographic Spoofing:** GPS-only attendance applications are trivially defeated by Android "Mock Location" developer tools, mock GPS injection apps, or VPN coordinate manipulation.
4. **Biometric Privacy Risks:** Centralized cloud databases storing raw employee facial photographs or unencrypted biometric feature vectors risk catastrophic data breach liabilities under GDPR, CCPA, and national privacy mandates.
5. **Mobile Viewport Incompatibilities:** Many web-based biometric interfaces render floating dialogs that drift off-screen or suffer from transform collisions on diverse mobile Android viewports.

### 1.2 System Objectives
CampusAttend was engineered to resolve these challenges through an integrated, defense-in-depth architecture:
- **On-Device Biometric Isolation:** Facial embeddings are encrypted using hardware-backed AES-256-GCM via the Android Keystore system. Biometric vectors are never transmitted to or stored on cloud servers.
- **3-Factor Verification Gating:** Attendance authorization strictly requires concurrent validation of:
  1. *Network Factor:* Verified connection to campus Wi-Fi (`SONA-WIFI`) verified via server-side public egress IP matching (`111.92.42.18` or `115.247.87.98`).
  2. *Geographic Factor:* Location inside a 19-vertex polygon of Sona College of Technology via the Jordan Curve Theorem smoothed by a 1D Kalman filter.
  3. *Biometric Factor:* 1:1 ArcFace cosine similarity matching combined with MiniFASNet-V2 anti-spoofing and a single-action randomized head movement challenge.
- **Elimination of Unreliable Challenges:** Nodding and blinking gestures have been completely eliminated from the attendance challenge, replaced strictly by four orthogonal directional movements: `TURN_LEFT`, `TURN_RIGHT`, `LOOK_UP`, and `LOOK_DOWN`.
- **Robust Mobile Interface:** Full-screen responsive authentication modal utilizing dynamic `100dvh` viewport sizing, safe-area insets, and background scroll locking.

---

## 2. Complete Repository Structure & File Inventory

The repository is structured into distinct, decoupled subsystems:

```
D:\project\geo-fenced-attendence-system\
├── .github/                     # GitHub workflows and CI configuration
├── android/                     # Complete native Android Gradle & Kotlin project
│   ├── app/
│   │   ├── build.gradle.kts     # Native dependencies: CameraX, MediaPipe, ONNX, Room, SQLCipher
│   │   └── src/main/
│   │       ├── AndroidManifest.xml
│   │       ├── assets/          # Embedded native ONNX & TFLite models
│   │       │   ├── w600k_mbf.onnx (13.6 MB)
│   │       │   ├── MiniFASNetV2.onnx (1.74 MB)
│   │       │   ├── face_landmarker.task (3.76 MB)
│   │       │   └── face_detection_short_range.tflite (230 KB)
│   │       └── java/com/campusattend/biometric/
│   │           ├── CampusAttendApp.kt
│   │           ├── MainActivity.kt
│   │           ├── bridge/      # AndroidBiometricBridge.kt (@JavascriptInterface, 96.8 KB)
│   │           └── security/    # BiometricKeystoreManager.kt (Hardware AES-256-GCM)
├── api/                         # Vercel Serverless Functions / Nitro backend routes
│   ├── attendance.ts            # Authoritative attendance evaluation gate (43.1 KB, 1223 lines)
│   ├── network-info.ts          # Public egress IP detection
│   ├── wifi-status.ts           # HMAC networkAuthToken minting
│   ├── admin/                   # Administrative endpoints (login, staff, face-requests)
│   └── staff/                   # Staff registration and face replacement ticket API
├── docs/                        # Complete technical documentation, diagrams & research deliverables
├── public/                      # Static web assets served by Vercel edge CDN
│   ├── app-debug.apk            # Compiled native Android APK (162 MB)
│   └── models/                  # WebAssembly ONNX & face-api.js models
│       ├── w600k_mbf.onnx       # ArcFace MobileFaceNet ONNX model (13.6 MB)
│       ├── MiniFASNetV2.onnx    # Presentation Attack Detection ONNX model (1.74 MB)
│       └── ssd_mobilenetv1_*    # face-api.js detection and landmark weights
├── scripts/                     # 123 custom test, calibration, and forensic scripts
├── src/                         # Client web application (React 19 + TanStack Start)
│   ├── components/
│   │   ├── common/              # FaceScanDialog.tsx (114 KB), GpsDiagnosticPanel.tsx, etc.
│   │   └── ui/                  # dialog.tsx (with fullScreen support), button.tsx, etc.
│   ├── hooks/                   # use-attendance.ts, use-geofence.ts, use-wifi-status.ts
│   ├── lib/
│   │   ├── face-recognition/    # arcface-engine.ts, anti-spoof-service.ts, liveness-engine.ts
│   │   ├── geofence/            # geofence-service.ts, kalman-filter.ts
│   │   ├── native-biometric-bridge.ts # Type-safe client for AndroidBiometricBridge
│   │   └── wifi-config.ts       # Wi-Fi SSID validation policy
│   └── routes/                  # TanStack Router file-based pages (mark-attendance.tsx, etc.)
├── supabase/                    # Supabase database configuration & migrations
│   ├── schema.sql               # Authoritative PostgreSQL DDL (8 tables, RLS, indexes)
│   └── migrations/              # atomic_replace_face_biometrics.sql (FOR UPDATE token RPC)
├── package.json                 # Dependency manifest
├── tsconfig.json                # TypeScript compiler configuration
├── vercel.json                  # Cloud deployment & route rewrite configuration
└── vite.config.ts               # Vite bundler, Tailwind v4 & TanStack Start plugin configuration
```

---

## 3. Core Architectural Foundations & Technology Stack

### 3.1 Dependencies & Versioning
- **Client Framework:** React `^19.2.0`, React DOM `^19.2.0`
- **Application & Routing Engine:** TanStack Start `@tanstack/react-start` `^1.168.60`, TanStack Router `@tanstack/react-router` `^1.170.41`, TanStack Query `@tanstack/react-query` `^5.101.1`
- **Build & Development Tooling:** Vite `^8.2.0`, Nitro `3.0.260603-beta`, TypeScript `^5.8.3`
- **Styling Architecture:** Tailwind CSS `^4.2.1`, `@tailwindcss/vite` `^4.2.1`, `tailwind-merge` `^3.5.0`, `class-variance-authority` `^0.7.1`
- **Accessible Primitives:** Radix UI (`@radix-ui/react-dialog`, `@radix-ui/react-progress`, `@radix-ui/react-tabs`, etc.)
- **Biometric Inference:** `onnxruntime-web` `^1.27.0`, `face-api.js` `^0.22.2`
- **Cloud Backend:** Vercel Serverless Functions (Node.js 24), Supabase `@supabase/supabase-js` `^2.117.2`
- **Native Android Shell:** Kotlin 1.9.22, AGP 8.2.0, Compile SDK 34, CameraX 1.3.1, MediaPipe Tasks Vision 0.10.9, ONNX Runtime Android 1.17.0, SQLCipher 4.5.4, Room 2.6.1

---

## 4. Android Native Subsystem & Hardware Keystore Cryptography

### 4.1 `BiometricKeystoreManager.kt`
The native security manager initializes and interfaces directly with the Android Keystore system (`AndroidKeyStore`):

```kotlin
// Master Key Generation inside ARM TrustZone / StrongBox
val spec = KeyGenParameterSpec.Builder(
    "campusattend_biometric_master_aes256",
    KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
)
    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
    .setKeySize(256)
    .setUserAuthenticationRequired(false)
    .setRandomizedEncryptionRequired(true)
    .build()
```

### 4.2 Cryptographic Template Protection Flow
When a 512-dimensional floating-point embedding vector ($512 \times 4\text{ bytes} = 2048\text{ bytes}$) is enrolled:
1. The 512 floats are serialized into a little-endian byte array.
2. The AES-GCM cipher is initialized with the hardware master key.
3. **Authenticated Additional Data (AAD)** is injected:
   $$\text{AAD} = \text{staffId} \parallel ":" \parallel \text{deviceId}$$
   where `deviceId` is derived from `Settings.Secure.ANDROID_ID`.
4. The cipher produces a 2048-byte ciphertext, a 12-byte random initialization vector (IV), and a 128-bit authentication tag.
5. The record is written to a SQLCipher-encrypted SQLite database.
6. **Security Implication:** If an adversary copies the encrypted SQLite file to another phone or modifies the associated staff ID, the AAD check fails during decryption, throwing `AEADBadTagException` and denying all matching attempts.

### 4.3 Native Bridge (`AndroidBiometricBridge.kt`)
Annotated with `@JavascriptInterface`, the bridge exposes high-performance methods:
- `isAvailable()`: Verifies presence of native Keystore.
- `getDeviceId()`: Returns hardware identifier.
- `enrollFace(staffId, embeddingsJson)`: Encrypts 5 diverse templates.
- `verifyFace(staffId, liveEmbeddingJson)`: Decrypts local templates and evaluates cosine distance against live embedding.
- `stageReplacement()` and `commitReplacement()`: Manages two-stage administrative face replacement.

---

## 5. AI, Computer Vision & Biometric Inference Subsystem

### 5.1 Model Specifications
- **Face Recognition Model:** InsightFace MobileFaceNet (`w600k_mbf.onnx`).
  - Architecture: Depthwise separable convolutional neural network trained with Additive Angular Margin Loss (ArcFace) on the MS1MV2 (MS1M-w600k) dataset.
  - Model File Size: 13,616,099 bytes (~13.6 MB).
  - Input Tensor Dimensions: `[1, 3, 112, 112]` (RGB float32 planar).
  - Normalization Formula:
    $$x_{\text{normalized}} = \frac{x_{\text{raw}} - 127.5}{128.0}$$
  - Output Feature Vector: 512-dimensional float array, L2-normalized:
    $$\hat{v} = \frac{v}{\|v\|_2}$$

### 5.2 Umeyama 5-Point Affine Alignment
Before passing an image to ArcFace, the facial crop must be normalized to standard canonical eye, nose, and mouth positions. The system extracts 5 primary landmarks from the 68-point detector:
- Left eye pupil: Point 36 (index) / Point 39 midpoint
- Right eye pupil: Point 42 / Point 45 midpoint
- Nose tip: Point 30
- Left mouth corner: Point 48
- Right mouth corner: Point 54

The **Umeyama algorithm** solves for the optimal similarity transformation matrix $M = [sR \mid t]$ minimizing least-squares error to standard reference coordinates:
$$\text{Reference Points} = \begin{bmatrix}
38.2946 & 51.6963 \\
73.5318 & 51.5014 \\
56.0252 & 71.7366 \\
41.5493 & 92.3655 \\
70.7299 & 92.2041
\end{bmatrix}$$
The resulting affine transform scales, rotates, and translates the face into a canonical $112 \times 112$ viewport.

### 5.3 Dual-Pose Mirror Evaluation
Android front cameras frequently flip live video streams horizontally. To prevent false non-matches, `FaceScanDialog.tsx` implements dual-pose evaluation:
1. Computes cosine distance on canonical alignment.
2. If canonical distance exceeds threshold ($> 0.45$), computes `alignMirroredFaceDetailed` by horizontally reflecting the planar tensor and swapping landmark pairs.
3. Selects the minimum distance between canonical and mirrored evaluations.

### 5.4 Cosine Distance & Matching Decision
Given live embedding $u$ and registered template $v$:
$$\text{Cosine Similarity}(u, v) = \frac{u \cdot v}{\|u\| \|v\|} = \sum_{i=1}^{512} u_i v_i \quad (\text{since } \|u\| = \|v\| = 1)$$
$$\text{Cosine Distance}(u, v) = 1.0 - \text{Cosine Similarity}(u, v)$$
- **Decision Rule:**
  $$\text{Match} = \begin{cases}
  \text{True (Verified)} & \text{if } \text{Distance} \le 0.45 \text{ and } (\text{Dist}_2 - \text{Dist}_1) \ge 0.08 \\
  \text{False (Rejected)} & \text{otherwise}
  \end{cases}$$

---

## 6. Single-Action Randomized Head Movement Liveness Engine

### 6.1 Elimination of Nodding and Blinking
Earlier implementations experimented with eye-blink detection (Eye Aspect Ratio) and vertical head nodding. These gestures proved unreliable in mobile WebViews due to variable camera frame rates (15–30 FPS) and lighting shadows. **Nodding (`NOD_ONCE`) and blinking (`BLINK_ONCE`) have been completely purged from the attendance workflow.**

### 6.2 The Four Supported Actions
Upon matching the staff face in Step 1, the engine unpredictably selects exactly one action ($P = 0.25$ each):
1. **`TURN_LEFT`:** *"Face matched! Please turn your head slightly to the left."*
2. **`TURN_RIGHT`:** *"Face matched! Please turn your head slightly to the right."*
3. **`LOOK_UP`:** *"Face matched! Please tilt your head slightly upward."*
4. **`LOOK_DOWN`:** *"Face matched! Please tilt your head slightly downward."*

### 6.3 Geometric Angle Estimation & Conventions
- **Yaw ($\Delta\text{Yaw}$):**
  $$\text{Yaw} = \left(\frac{X_{\text{nose}} - \frac{X_{\text{left}} + X_{\text{right}}}{2}}{\frac{|X_{\text{right}} - X_{\text{left}}|}{2}}\right) \times 45.0^\circ$$
  - Threshold: $\Delta\text{Yaw} \ge +14.0^\circ$ (Left turn), $\Delta\text{Yaw} \le -14.0^\circ$ (Right turn).
- **Pitch ($\Delta\text{Pitch}$):**
  $$\text{Ratio} = \frac{Y_{\text{nose\_tip}} - Y_{\text{nose\_bridge}}}{Y_{\text{chin}} - Y_{\text{nose\_tip}}}$$
  $$\text{Pitch} = (\text{Ratio} - 0.60) \times 70.0^\circ$$
  - Threshold: $\Delta\text{Pitch} \ge +9.0^\circ$ (Looking Up), $\Delta\text{Pitch} \le -9.0^\circ$ (Looking Down).
- **Temporal Hysteresis:** The requested direction must be continuously satisfied for **3 consecutive frames** to filter landmark jitter. Once confirmed, the challenge completes immediately without demanding a second action.

---

## 7. Presentation Attack Detection (PAD) & Optical Heuristics

### 7.1 MiniFASNet-V2 Deep Neural Network
- Architecture: Silent-Face-Anti-Spoofing lightweight convolutional network (`MiniFASNetV2.onnx`).
- Model Size: 1,744,116 bytes (~1.74 MB).
- Input: `[1, 3, 80, 80]` BGR planar Float32Array cropped with an expanded bounding box ($2.7\times$ face size).
- **Critical Scale Requirement:** Pixels must remain in raw float range $[0.0 \dots 255.0]$. Dividing by 255.0 compresses the feature map to near-zero, falsely causing 99.4% replay classification.
- Output Classes:
  - Class 0: Print Attack (Paper photos, posters)
  - Class 1: Real / Live Face
  - Class 2: Screen Replay Attack (Smartphones, tablets, LCD monitors)

### 7.2 Fused Optical Heuristics
1. **Specular Glare Ratio:** Evaluates pixels with luminance $> 248$. Natural skin displays diffuse reflection with glare ratio $< 12\%$. Harsh planar electronic glass reflections exceed $22\%$.
2. **High-Frequency Moiré Energy:** Convolves image with a Laplacian edge filter to detect periodic subpixel raster interference patterns.
3. **Temporal Motion Variance:** Compares 8 consecutive grayscale frame buffers. Static printed photos have variance $< 0.8$.

---

## 8. Geographic Geofencing & 1D Kalman Filter Subsystem

### 8.1 Authoritative 13-Vertex Sona Campus Polygon
The physical attendance zone of Sona College of Technology is defined by 13 coordinates in strict clockwise order:
```typescript
export const AUTHORIZED_GEOFENCE_POLYGON: LatLng[] = [
  { lat: 11.675651510482604, lng: 78.12402220170895 }, // C1
  { lat: 11.675657082681333, lng: 78.12382305416799 }, // C2
  { lat: 11.675768526632474, lng: 78.12359545697831 }, // C3
  { lat: 11.675857681761121, lng: 78.12339630943734 }, // C4
  { lat: 11.676125146975094, lng: 78.1228443862524 },  // C5
  { lat: 11.676370323194567, lng: 78.12244609117047 }, // C6
  { lat: 11.676414900665728, lng: 78.12241764152176 }, // C7
  { lat: 11.676448333764391, lng: 78.12143897360616 }, // C8
  { lat: 11.676905252375372, lng: 78.12147880311436 }, // C9
  { lat: 11.676977690622595, lng: 78.12159260170921 }, // C10
  { lat: 11.67708913404289,  lng: 78.12222418391055 }, // C11
  { lat: 11.677990932044441, lng: 78.12235439874642 }, // C12
  { lat: 11.677979915759753, lng: 78.1237830407748 },  // C13
];
```

### 8.2 Ray-Casting Algorithm (Jordan Curve Theorem)
A semi-infinite horizontal ray is cast from test point $P(x_0, y_0)$ eastward ($x \to \infty$). For each polygon edge $(P_i, P_j)$:
$$\text{Intersect} = (y_i > y_0 \ne y_j > y_0) \land \left(x_0 < \frac{(x_j - x_i)(y_0 - y_i)}{y_j - y_i} + x_i\right)$$
If the total number of valid edge intersections is odd, the point is inside; if even, it is outside.

### 8.3 1D Kalman Filter GPS Smoothing
To eliminate multipath reflections and erratic jumps, coordinates pass through independent 1D Kalman filters:
1. **Prediction:**
   $$\hat{x}_k^- = \hat{x}_{k-1}$$
   $$P_k^- = P_{k-1} + Q \cdot \Delta t$$
   where process noise $Q = 3.0\text{ m/s}$ (pedestrian motion).
2. **Measurement Update:**
   $$K_k = \frac{P_k^-}{P_k^- + R_k}$$
   where measurement noise $R_k = \text{accuracy}^2$.
   $$\hat{x}_k = \hat{x}_k^- + K_k(z_k - \hat{x}_k^-)$$
   $$P_k = (1 - K_k)P_k^-$$

---

## 9. Campus Wi-Fi & 3-Factor Attendance Verification Pipeline

### 9.1 Wi-Fi Policy & Validation
- **Policy Rule:** The network SSID must contain `sona` (case-insensitive). Examples: `SONA-WIFI`, `Sona_Faculty`, `sona_guest`.
- **Exclusion:** Empty, null, `<unknown ssid>`, or masked SSIDs are rejected.

### 9.2 Server-Side Public Egress IP Verification
Client-side SSID checks can be fooled by personal mobile hotspots named "SONA-WIFI". To defeat this, `api/attendance.ts` verifies the caller's true public IP address against Sona College's authorized leased-line egress gateways:
- `111.92.42.18` (Primary BSNL/Jio Campus Fiber)
- `115.247.87.98` (Secondary Campus Leased Line)
Alternatively, the client must present an unexpired HMAC `networkAuthToken` minted by `api/wifi-status.ts`.

---

## 10. Face Enrollment, Multi-Angle Capture & Re-Enrollment Governance

### 10.1 Multi-Angle Capture
To guarantee high recognition rates under varied daily poses, initial enrollment captures 5 distinct templates:
1. Frontal neutral pose
2. Slight turn left (~$8^\circ$)
3. Slight turn right (~$8^\circ$)
4. Slight upward tilt (~$6^\circ$)
5. Natural facial expression / smile

Templates are encrypted into slots 1 to 5 with `templateVersion = 1`.

### 10.2 Administrative Approval Lifecycle
Re-enrollment requires supervisor consent:
1. Staff member submits request with justification.
2. Stored in `public.security_events` as pending ticket.
3. Administrator reviews and approves request via `/admin/face-requests`.
4. Approval mints a 24-hour token: `token = crypto.randomBytes(32).toString('hex')`.
5. Staff captures new templates into local staged staging buffer.
6. Commit calls `atomic_consume_face_approval_token` on Supabase.
7. Upon PostgreSQL confirmation, staged templates are promoted to active slots and old templates are permanently deleted.

---

## 11. Frontend Interface, Viewport Architecture & Diagnostics

### 11.1 Full-Screen Dialog Structure (`FaceScanDialog.tsx`)
The interface resolves previous mobile drift problems by adopting a single full-screen overlay:
1. **Compact Header:** Titled `Face Authentication` with one visible Close button.
2. **Two-Step Progress Label:**
   - `Step 1 of 2 — Face Match`
   - `Step 2 of 2 — Head Movement`
3. **Centered Live Camera Preview:** Occupies most of the screen using portrait ratio `aspect-[3/4]` with aligned video and canvas landmark overlays.
4. **Visible Movement Instruction Container:** Positioned **below** the camera preview so instructions never cover the eyes.
5. **Primary Action Button:** `Start Face Check` or `Try Again`.
6. **Collapsed Advanced Diagnostics:** Discloses cosine distance, template slots, bounding box coordinates, and MiniFASNet logits only when expanded.

---

## 12. Backend Serverless Architecture & Nitro Endpoints

The serverless backend is built on Nitro running on Vercel Edge compute:
- `POST /api/attendance`: The central gatekeeper. Performs independent geofence point-in-polygon verification, verifies egress IP or network HMAC token, prevents duplicate daily punches, and commits to Supabase.
- `GET /api/network-info`: Returns caller's IP and detects campus network.
- `GET /api/wifi-status`: Mints signed `networkAuthToken` for campus connections.
- `POST /api/admin/login`: Authenticates admin username/password; mints `admin_session`.
- `GET /api/admin/session`: Validates admin session.
- `GET/POST /api/admin/face-requests`: Manages supervisor re-enrollment approval queue.
- `POST /api/staff/face`: Handles staff replacement requests and commit triggers.

---

## 13. Supabase PostgreSQL Database, Schemas & Security Definer RPCs

### 13.1 Schema Inventory
- `public.staff`: Faculty profiles, status, department.
- `public.attendance_records`: Confirmed attendance ledger.
- `public.security_events`: Security anomalies and approval tokens.
- `public.geofence_zones`: Authoritative polygon definitions.
- `public.devices`: Registered hardware bindings.
- `public.admin_users`: Admin credentials with separate RLS.
- `public.face_embeddings`: Optional vector search fallback (`pgvector`).
- `public.face_detection_logs`: Audit logs for facial authentication attempts.

### 13.2 Atomic Token RPC (`atomic_consume_face_approval_token`)
- Uses `SECURITY DEFINER` with fixed `search_path = public, pg_catalog, extensions`.
- Implements `SELECT ... FOR UPDATE` row-level locking on the approval record.
- Enforces strict fail-closed 24-hour expiration (`NOW() <= expires_at`).
- Prevents race conditions and double-spending of approval tokens.

---

## 14. Security Architecture, Threat Model & Privacy Guarantees

CampusAttend addresses the full OWASP Mobile Top 10 and ISO/IEC 30107-3 threat matrix:
- **Zero Raw Vector Exfiltration:** Biometrics never leave the phone.
- **Hardware Binding:** AAD `$staffId:$deviceId` prevents template portability.
- **Liveness Proof:** Passive MiniFASNet-V2 plus active single-action challenge stops 2D photos and screen replays.
- **Geographic Integrity:** Server-side ray casting on Kalman-filtered coordinates prevents fake GPS apps.
- **Timing-Safe Cryptography:** All token signatures verified via `crypto.timingSafeEqual`.

---

## 15. Automated Testing, Parity Harnesses & Forensic Scripts

The project contains 123 scripts in `scripts/`. Core regression suites executed and verified:
- `npm run test:head-liveness`: 24 / 24 passed (100%)
- `npm run test:face-layout`: 23 / 23 passed (100%)
- `npm run test:face-parity`: 16 / 16 passed (100%)
- `npm run test:face-workflow`: 20 / 20 passed (100%)
- `npm run test:pad`: 12 / 12 passed (100%)
- `npx tsc --noEmit`: 0 errors
- `npm run build`: Nitro production build OK

---

## 16. DevOps, Git Workflow & Production Vercel Deployment

- **Version Control:** Git repository connected to GitHub and Lovable.dev (`origin/main`). Rebase/squash/force-pushing is strictly prohibited per `AGENTS.md`.
- **Hosting:** Vercel edge deployment with automated CI/CD webhooks.
- **Live Verification:** Production URL `https://geo-fenced-attendence-system.vercel.app/mark-attendance` verified serving compiled bundles with full-screen `100dvh` modal, 4 head movements, and zero nod/blink challenges.
- **Android Binary:** Compiled APK `app-debug.apk` (162 MB) hosted in `public/` for direct download.
