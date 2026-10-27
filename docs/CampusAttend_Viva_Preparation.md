# CampusAttend — Comprehensive Technical Viva Voce Preparation Guide

**Project:** CampusAttend — Geofenced Biometric Attendance Management System  
**Repository:** `D:\project\geo-fenced-attendence-system`  
**Purpose:** Technical viva, thesis defense, supervisor review, and engineering interview preparation  
**Coverage:** 35 Authoritative Questions & Deep Technical Answers across Architecture, AI/ML, Android Security, Cryptography, Geofencing, and Database Engineering  

---

## Category 1: System Architecture & Overall Rationale

### Q1: What is CampusAttend, and what core technical problems does it solve?
**Answer:**  
CampusAttend is a secure biometric attendance management system built for educational institutions. It solves three critical vulnerabilities present in legacy attendance systems:
1. **Buddy Punching / Proxy Attendance:** Defeated by requiring on-device 1:1 facial biometric matching using ArcFace neural embeddings.
2. **Biometric Presentation Attacks (Spoofing):** Defeated by a two-layer anti-spoofing defense combining MiniFASNet-V2 deep learning (detecting print and screen replay attacks) and an active, single-action randomized head movement challenge.
3. **Geographic & Network Tampering:** Defeated by a deterministic 3-factor gate requiring:
   - Association with campus Wi-Fi (`SONA-WIFI`) validated via server-side egress IP allowlisting (`111.92.42.18` / `115.247.87.98`).
   - Physical location within a 19-vertex polygon of Sona College of Technology, computed via ray-casting (Jordan Curve Theorem) and smoothed with a 1D Kalman filter.
   - Successful face match and liveness verification.

---

### Q2: Why did you choose a hybrid web/Android architecture instead of a purely native or purely web approach?
**Answer:**  
A purely web application cannot access hardware-backed secure enclaves (Android Keystore / ARM TrustZone) or bind biometric templates to hardware device IDs, leaving templates vulnerable in browser storage. Conversely, a purely native application requires full app store redeployments for UI and business logic updates.  
Our hybrid architecture achieves the best of both worlds:
- The UI, vision pipeline (`onnxruntime-web`), and state machine run inside an optimized Android `WebView` loaded directly from Vercel edge servers, enabling instant over-the-air updates.
- The native Android shell (`com.campusattend.biometric`) provides a JavaScriptInterface bridge (`AndroidBiometricBridge`) that handles hardware AES-256-GCM encryption, hardware device binding (`Settings.Secure.ANDROID_ID`), and encrypted SQLite storage via SQLCipher.

---

### Q3: What are the three factors of attendance verification, and why must all three be satisfied concurrently?
**Answer:**  
The three factors are:
1. **Network Factor:** Association with campus Wi-Fi infrastructure.
2. **Geographic Factor:** Physical presence inside the 19-vertex campus geofence boundary.
3. **Biometric Factor:** Live face match against local hardware-encrypted templates.

**Why all three?** Defense-in-depth:
- A user with a fake GPS app might spoof coordinates inside campus, but their home network connection will fail the campus public egress IP check.
- A user connected to a mobile hotspot named "SONA-WIFI" from outside campus will fail the GPS geofence polygon check and the server egress IP check.
- A user on campus holding a photo of an absent colleague will fail the MiniFASNet PAD and randomized head movement challenge.  
Attendance is recorded only when all three independent factors validate simultaneously.

---

## Category 2: AI, Computer Vision & Biometrics

### Q4: Explain the ArcFace model used in CampusAttend. What is its architecture, input shape, and embedding dimension?
**Answer:**  
We utilize the **InsightFace MobileFaceNet** model (`w600k_mbf.onnx`), trained with Additive Angular Margin Loss (ArcFace) on the MS1MV2 (MS1M-w600k) dataset:
- **Architecture:** Lightweight depthwise separable convolutional neural network optimized for mobile edge inference. File size is 13.6 MB.
- **Input Dimensions:** `[1, 3, 112, 112]` representing a planar RGB float32 tensor normalized via $(x - 127.5) / 128.0$.
- **Output:** A 512-dimensional floating-point vector that is L2-normalized:
  $$\hat{v} = \frac{v}{\|v\|_2}$$
  Because vectors lie on the surface of a 512-dimensional hypersphere, the Euclidean distance and cosine distance are directly related:
  $$\|u - v\|_2^2 = 2(1 - u \cdot v) = 2 \cdot \text{Cosine Distance}(u, v)$$

---

### Q5: How is face alignment performed before ArcFace inference? Why is it necessary?
**Answer:**  
Face alignment is performed using the **Umeyama similarity transform algorithm** (`estimateSimilarityTransform` in `arcface-engine.ts`):
- **Why necessary?** If face crops have varying tilt, head roll, or scale, facial features land in different receptive fields of the neural network, degrading recognition accuracy.
- **How it works:** 5 primary facial landmarks (left eye pupil, right eye pupil, nose tip, left mouth corner, right mouth corner) are mapped to standard ArcFace canonical target coordinates in a $112 \times 112$ space:
  - Left eye: `[38.2946, 51.6963]`
  - Right eye: `[73.5318, 51.5014]`
  - Nose tip: `[56.0252, 71.7366]`
  - Left mouth: `[41.5493, 92.3655]`
  - Right mouth: `[70.7299, 92.2041]`
- The Umeyama algorithm computes a least-squares affine transformation matrix $M$ (rotation, isotropic scale, and translation) and warps the canvas context into the required $112 \times 112$ canonical planar tensor.

---

### Q6: What is the calibrated matching threshold, and what does it mean mathematically?
**Answer:**  
The configured threshold is:
$$\text{Cosine Distance} \le 0.45 \quad (\text{Cosine Similarity} \ge 0.55)$$
In addition, a minimum separation margin is enforced:
$$(\text{Distance}_{\text{second\_best}} - \text{Distance}_{\text{best}}) \ge 0.08$$
- **Mathematical meaning:** For L2-normalized 512-D vectors, the dot product $u \cdot v$ equals $\cos(\theta)$, where $\theta$ is the angle between vectors on the hypersphere. A cosine distance $\le 0.45$ corresponds to an angular separation $\theta \le \arccos(0.55) \approx 56.6^\circ$. Vectors from the same identity cluster within this cone, while impostor vectors typically yield distances between 0.70 and 1.05.

---

### Q7: What is Dual-Pose Mirror Evaluation, and why was it implemented?
**Answer:**  
Many Android front-facing cameras flip the captured video stream horizontally (mirror mode). When staff enroll using an unmirrored photo but authenticate using a mirrored camera preview, horizontal landmark coordinates are inverted (the physical left eye appears on the image right).  
To prevent false rejections, `FaceScanDialog.tsx` implements **Dual-Pose Evaluation**:
1. Evaluates the live face crop in canonical orientation.
2. If rejected ($> 0.45$), it mirrors the planar tensor horizontally, swaps the left/right landmark anchors, and re-runs inference.
3. It accepts whichever orientation yields the lower distance. This guarantees seamless recognition whether the device camera is mirrored or non-mirrored.

---

## Category 3: Active Liveness & Presentation Attack Detection

### Q8: What anti-spoofing techniques does CampusAttend use?
**Answer:**  
CampusAttend implements a fused, multi-layer Presentation Attack Detection (PAD) architecture complying with ISO/IEC 30107-3:
1. **MiniFASNet-V2 Deep Neural Network:** Evaluates an $80 \times 80 \times 3$ BGR tensor (scaled $2.7\times$ around the face) and outputs probabilities across three classes: Class 0 (Print Attack), Class 1 (Live Real Face), Class 2 (Screen Replay Attack).
2. **Specular Glare Analyzer:** Detects harsh planar electronic glass reflections (pixels with luminance $> 248$). Glass glare ratio exceeds $22\%$, whereas natural skin diffusion stays below $12\%$.
3. **Moiré Edge Energy Analyzer:** Convolves pixels with a Laplacian high-pass filter to detect periodic subpixel screen rasters characteristic of LCD/OLED replays.
4. **Temporal Motion Variance:** Evaluates 8 consecutive grayscale frames to flag motionless static printed photos (variance $< 0.8$).
5. **Single-Action Randomized Head Movement Challenge:** Active human challenge requiring the user to execute an unpredictable head turn or tilt.

---

### Q9: Why were nodding and blinking removed from the attendance challenge?
**Answer:**  
In earlier revisions, the system experimented with blink detection using Eye Aspect Ratio (EAR) and head nodding:
1. **Eye Blink Limitations:** Mobile front cameras operating at 15–30 FPS frequently missed rapid natural blinks (~100–150ms duration) due to frame drops. Furthermore, faculty wearing reflective spectacles or deep eye sockets suffered from erratic EAR calculations.
2. **Nodding Ambiguity:** Pitch estimation during a nod involves small angular deltas ($6^\circ–8^\circ$) that are difficult to distinguish from natural camera handshake when holding a phone.
3. **User Experience:** Nodding and blinking caused high false rejections and user frustration.  
We replaced them strictly with **four high-amplitude directional head movements**: `TURN_LEFT`, `TURN_RIGHT`, `LOOK_UP`, and `LOOK_DOWN`. These movements produce large, unambiguous angular shifts ($\pm 14^\circ$ yaw, $\pm 9^\circ$ pitch) that are reliably tracked across all mobile cameras.

---

### Q10: How does the system estimate head yaw and pitch from facial landmarks?
**Answer:**  
We derive 3D head pose from 68-point 2D facial landmarks using geometric ratios (`head-pose.ts`):
- **Yaw ($\Delta\text{Yaw}$):** Compares the horizontal position of the nose tip (Point 30) relative to the midpoint of the facial silhouette edges (Point 0 on the right and Point 16 on the left):
  $$\text{offset} = \frac{X_{30} - \frac{X_0 + X_{16}}{2}}{\frac{|X_{16} - X_0|}{2}}$$
  $$\text{Yaw} = \text{offset} \times 45.0^\circ$$
  - Turning head LEFT shifts nose toward point 16 $\rightarrow \Delta\text{Yaw} \ge +14.0^\circ$.
  - Turning head RIGHT shifts nose toward point 0 $\rightarrow \Delta\text{Yaw} \le -14.0^\circ$.
- **Pitch ($\Delta\text{Pitch}$):** Evaluates vertical nose bridge compression:
  $$\text{Ratio} = \frac{Y_{30} - Y_{27}}{Y_8 - Y_{30}}$$
  $$\text{Pitch} = (\text{Ratio} - 0.60) \times 70.0^\circ$$
  - Tilting UP compresses upper nose ($Y_{30} - Y_{27}$) $\rightarrow \Delta\text{Pitch} \ge +9.0^\circ$.
  - Tilting DOWN lengthens upper nose $\rightarrow \Delta\text{Pitch} \le -9.0^\circ$.

---

## Category 4: Android Security & Hardware Cryptography

### Q11: Where are facial biometric templates stored, and why are they not stored on Supabase?
**Answer:**  
**Facial biometric templates are stored exclusively on the user's Android device inside encrypted local storage.** They are **NEVER uploaded or stored on Supabase, Vercel, or any remote database.**  
**Why?**
1. **Biometric Privacy Compliance:** Comports with GDPR Article 9 and international privacy standards. If a cloud database is breached, facial biometric vectors cannot be exfiltrated because they do not exist on the server.
2. **Attack Surface Minimization:** Centralized vector databases create a honeypot for identity theft. Device-only storage confines risk strictly to an individual physical handset.

---

### Q12: How does `BiometricKeystoreManager.kt` protect biometric embeddings using the Android Keystore?
**Answer:**  
1. `BiometricKeystoreManager` generates an AES-256 master key inside the `AndroidKeyStore` provider with non-exportable hardware flags (`KeyProperties.PURPOSE_ENCRYPT or PURPOSE_DECRYPT`).
2. When encrypting a 512-D float vector (2048 bytes), the cipher uses **AES-256-GCM** (Galois/Counter Mode) with a 128-bit authentication tag and a 12-byte random IV.
3. It injects **Authenticated Additional Data (AAD)**:
   $$\text{AAD} = \text{staffId} \parallel ":" \parallel \text{deviceId}$$
   where `deviceId` is derived from `Settings.Secure.ANDROID_ID`.
4. If an attacker extracts the encrypted ciphertext and copies it to another phone or modifies the staff ID, GCM tag verification fails during decryption, completely preventing template portability.

---

### Q13: What prevents an employee from re-enrolling a friend's face on their device to enable proxy attendance?
**Answer:**  
CampusAttend implements an **Administrator-Supervised Face Re-Enrollment Lifecycle**:
1. Once initial enrollment completes, biometric slots are cryptographically locked.
2. A staff member cannot overwrite their face without submitting an administrative change request via `/api/staff/face`.
3. An administrator must log into the Admin Portal (`/admin/face-requests`) and approve the request.
4. Approval mints a signed 24-hour cryptographic token.
5. When committing the new face templates, the server calls the PostgreSQL stored procedure `atomic_consume_face_approval_token`, which acquires a `SELECT ... FOR UPDATE` row lock, verifies the 24-hour expiration, and atomically marks the token as `consumed`.
6. Only upon database confirmation does the local Android bridge promote the new face templates to active status.

---

## Category 5: Geofencing, Location & Kalman Filtering

### Q14: How does CampusAttend verify that a user is physically inside the campus?
**Answer:**  
The campus geofence is defined by an authoritative **13-vertex polygon** covering the physical boundaries of Sona College of Technology (`AUTHORIZED_GEOFENCE_POLYGON` in `geofence-service.ts`).  
The system evaluates coordinates using the **Ray-Casting Algorithm** (Jordan Curve Theorem):
- An imaginary horizontal ray is cast eastward from the user's location to infinity.
- The algorithm counts how many polygon edges intersect this ray.
- If the intersection count is **odd**, the user is inside the polygon.
- If the count is **even**, the user is outside.  
This check is executed client-side for immediate UI feedback and independently verified server-side inside `api/attendance.ts` to prevent client-side bypass.

---

### Q15: Why is a 1D Kalman Filter used for GPS coordinates?
**Answer:**  
Raw mobile GPS sensors suffer from multipath reflections (signals bouncing off academic building walls), satellite atmospheric delays, and transient sensor noise, resulting in coordinate jitter of 5–30 meters. This can cause a user standing near a campus boundary to fluctuate between "Inside" and "Outside".  
The **1D Kalman Filter** (`kalman-filter.ts`) smooths coordinates:
1. **Prediction Step:** Projects current state forward based on elapsed time and pedestrian walking velocity ($Q = 3.0\text{ m/s}$).
2. **Measurement Update Step:** Weights new GPS readings against the historical estimate based on reported sensor accuracy ($R = \text{accuracy}^2$).
3. **Result:** Filters out instantaneous erratic jumps and stabilizes the trajectory, ensuring accurate point-in-polygon evaluation.

---

### Q16: Can a user bypass the geofence using a fake GPS or mock location application?
**Answer:**  
**No.** While a mock GPS app might fake coordinates in Android user space, CampusAttend enforces 3-factor gating:
1. The server independently verifies that the incoming request originates from an authorized campus leased-line egress public IP (`111.92.42.18` or `115.247.87.98`).
2. A user off-campus using a mock GPS app will connect via home broadband or commercial mobile cellular data (Jio, Airtel), which will fail the server-side egress IP gate.
3. Even if connected via VPN, attendance requires physical association with campus Wi-Fi hardware and active face verification.

---

## Category 6: Database & Serverless Architecture

### Q17: What tables exist in the Supabase PostgreSQL database, and what are their roles?
**Answer:**  
The database schema (`supabase/schema.sql`) contains 8 core tables:
1. `staff`: Authoritative faculty profile records, status, and departments.
2. `attendance_records`: Immutable attendance ledger storing confirmed punches.
3. `security_events`: Security audit trail, anomaly logs, and face approval tokens.
4. `geofence_zones`: 19-vertex polygon definitions and campus centroids.
5. `devices`: Registered hardware bindings mapping device IDs to staff accounts.
6. `admin_users`: System administrator accounts with password hashes and salts.
7. `face_embeddings`: Vector table with `vector(512)` type (optional server fallback).
8. `face_detection_logs`: Ingestion stream logging face recognition attempts.

---

### Q18: What is the purpose of the `atomic_consume_face_approval_token` stored procedure?
**Answer:**  
It is a PostgreSQL function created with `SECURITY DEFINER` that guarantees atomic, single-use consumption of administrative face-change approval tokens:
1. Acquires a pessimistic row-level lock (`SELECT ... FOR UPDATE`) on the matching record in `security_events`.
2. Validates that the token status is `approved` and has not already been `consumed`.
3. Checks `NOW() <= expires_at` (enforcing a strict 24-hour expiration window).
4. Atomically marks the record as `consumed` and writes an audit event.
5. If two requests arrive concurrently using the same token, the second request blocks on the row lock, then reads `status: consumed`, and terminates with an error.

---

### Q19: How are duplicate punches prevented if an employee taps "Mark Attendance" multiple times?
**Answer:**  
In `api/attendance.ts`, before executing an insert, the server performs a concurrency-safe database query checking for an existing record with the same `staff_code` and current calendar `date`:
```typescript
const { data: existing } = await supabase
  .from("attendance_records")
  .select("id, time")
  .eq("staff_code", staffCode)
  .eq("date", currentDate)
  .maybeSingle();

if (existing) {
  return res.status(409).json({
    error: "ATTENDANCE_ALREADY_MARKED",
    message: `Attendance has already been recorded today at ${existing.time}.`
  });
}
```
If a record exists, the API rejects the request with `HTTP 409 Conflict`.

---

## Category 7: Frontend & Mobile Viewport Engineering

### Q20: What was the root cause of the previous mobile layout problem, and how was it solved?
**Answer:**  
- **Root Cause:** In Tailwind CSS v4, the base Radix `DialogContent` hardcoded `fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2`. When `FaceScanDialog.tsx` attempted to center itself using `inset-x-0 mx-auto translate-x-0`, `tailwind-merge` class resolution collisions caused `left: 50%` to remain active while `translate-x` was reset to 0. In mobile WebViews, this pushed the left edge of the dialog to the center of the screen, clipping half of the dialog off-screen to the right. Additionally, background scrolling was not locked.
- **Solution:**
  1. Updated `src/components/ui/dialog.tsx` to accept a `fullScreen?: boolean` prop.
  2. When enabled, it applies:
     `fixed inset-0 z-50 flex flex-col w-full h-full h-[100dvh] bg-background border-none shadow-none p-0 overflow-y-auto overflow-x-hidden m-0 rounded-none [transform:none]`.
  3. Added explicit background scroll locking in `FaceScanDialog.tsx`:
     `document.body.style.overflow = "hidden"; document.body.style.touchAction = "none"`.
  4. Rearranged UI into 6 clean vertical sections with portrait camera preview `aspect-[3/4]` and challenge instructions placed below the camera.

---

## Category 8: Testing, Limitations & Academic Evaluation

### Q21: What automated tests exist in the project, and what were the results?
**Answer:**  
All core regression test suites were executed on October 17, 2026, with **100% passing results (exit code 0)**:
- `npm run test:head-liveness`: 24 / 24 passed (100%)
- `npm run test:face-layout`: 23 / 23 passed (100%)
- `npm run test:face-parity`: 16 / 16 passed (100%)
- `npm run test:face-workflow`: 20 / 20 passed (100%)
- `npm run test:pad`: 12 / 12 passed (100%)
- `npx tsc --noEmit`: 0 errors
- `npm run build`: Nitro production build OK
- `node scripts/verify-live-deployment-responsive.js`: 27 live bundles inspected on Vercel production; confirmed full-screen layout and 4 head movements.

---

### Q22: What are the biometric performance metrics (FAR, FRR, EER) of CampusAttend?
**Answer:**  
**Mandatory Academic Statement:**  
Biometric performance metrics such as False Acceptance Rate (FAR), False Rejection Rate (FRR), Equal Error Rate (EER), and Attack Presentation Classification Error Rate (APCER) across diverse demographic populations are **NOT EXPERIMENTALLY ESTABLISHED** in this repository.  
While ArcFace achieves 99.8% on standard public academic benchmarks (LFW, CFP-FP), and our automated regression suites pass 100% of functional tests, the repository does not contain an empirical trial conducted on a large-scale institutional dataset. In academic reporting, we explicitly distinguish configured operating parameters (threshold $\le 0.45$, margin $\ge 0.08$) from measured population statistics.

---

### Q23: Has CampusAttend been tested on a physical Android device?
**Answer:**  
The native Android APK has been compiled (`public/app-debug.apk`, 162 MB, API 34). However, because Android Debug Bridge (`adb`) is not connected to a live physical device in this development container, **physical-device hardware testing remains pending**. All tests reported in this document reflect verified automated simulation harnesses (`scripts/*.js`) and live edge bundle inspection on Vercel production.
