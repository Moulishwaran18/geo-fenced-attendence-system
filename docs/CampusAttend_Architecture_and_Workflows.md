# CampusAttend — System Architecture and Operational Workflows

**Document Version:** 1.0.0 (Production Verified)  
**Project Name:** CampusAttend — Geofenced Biometric Attendance Management System  
**Repository Path:** `D:\project\geo-fenced-attendence-system`  
**Production URL:** `https://geo-fenced-attendence-system.vercel.app/`  
**Classification:** Authoritative Technical Reference  

---

## Table of Contents
1. [High-Level Architectural Overview](#1-high-level-architectural-overview)
2. [End-to-End System Component Architecture](#2-end-to-end-system-component-architecture)
3. [Face Enrollment Workflow (Multi-Angle Local Keystore Encryption)](#3-face-enrollment-workflow)
4. [Face Re-Enrollment & Single-Approval Lifecycle](#4-face-re-enrollment--single-approval-lifecycle)
5. [Live Attendance Verification & 3-Factor Gating](#5-live-attendance-verification--3-factor-gating)
6. [Single-Action Randomized Head Movement State Machine](#6-single-action-randomized-head-movement-state-machine)
7. [Presentation Attack Detection (PAD) Pipeline](#7-presentation-attack-detection-pad-pipeline)
8. [Kalman Filter & Ray-Casting Geofence Pipeline](#8-kalman-filter--ray-casting-geofence-pipeline)
9. [Security, Trust Boundaries & Cryptographic Data Flows](#9-security-trust-boundaries--cryptographic-data-flows)
10. [Production Cloud & Android Native Deployment Architecture](#10-production-cloud--android-native-deployment-architecture)

---

## 1. High-Level Architectural Overview

CampusAttend is an enterprise-grade academic biometric attendance management platform specifically engineered to eliminate identity impersonation (buddy punching), geographic spoofing, and biometric presentation attacks. The system unifies four foundational architectural principles:

1. **Zero-Trust On-Device Biometric Isolation:** Raw facial images, aligned crops, and 512-dimensional floating-point ArcFace biometric feature vectors are never transmitted over the internet or stored on central database servers. Biometric templates are stored exclusively on authorized Android hardware devices, encrypted with hardware-backed AES-256-GCM authenticated encryption through the Android Keystore system.
2. **Deterministic 3-Factor Presence Gating:** Attendance authorization requires concurrent fulfillment of:
   - **Network Verification:** Association with the campus Wi-Fi infrastructure (SSID containing `sona` and verification through campus egress public IPs `111.92.42.18` or `115.247.87.98`).
   - **Geographic Boundary Enforcement:** Device coordinates verified inside a 19-vertex polygon of Sona College of Technology via the Jordan Curve Theorem (Ray-Casting algorithm) smoothed by a 1D Kalman filter.
   - **Biometric & Liveness Verification:** 1:1 ArcFace cosine similarity matching combined with neural presentation attack detection (MiniFASNet-V2) and a randomized single-action head movement challenge.
3. **Hardware Device Binding & Replay Immunity:** Biometric templates and authentication sessions are cryptographically bound to hardware device identifiers (`Settings.Secure.ANDROID_ID`) and single-use cryptographic attempt nonces.
4. **Single-Approval Re-Enrollment Governance:** Staff members cannot arbitrarily change their enrolled face. Re-enrollment requires submission of an administrative ticket, cryptographic approval token minting by an authenticated supervisor, and atomic token consumption in PostgreSQL via `SELECT ... FOR UPDATE` row locks.

```mermaid
graph TD
    subgraph ClientLayer["User Device (Android Phone / WebView)"]
        UI["React 19 / TanStack Router UI"]
        Camera["Camera Video Stream (HTML5/WebRTC)"]
        FaceEngine["Face Alignment & ArcFace Engine (WASM)"]
        PAD["MiniFASNet-V2 PAD & Optical Filters"]
        Liveness["Randomized Head Pose Liveness Engine"]
        Bridge["AndroidBiometricBridge (@JavascriptInterface)"]
        Keystore["Android Keystore (Hardware AES-256-GCM)"]
        RoomDB["SQLCipher / Local Encrypted Storage"]
    end

    subgraph NetworkLayer["Campus Network Boundary"]
        WifiAP["Campus Wi-Fi AP ('SONA-WIFI')"]
        Egress["Campus Gateway Egress IP (111.92.42.18 / 115.247.87.98)"]
    end

    subgraph ServerlessLayer["Cloud Backend (Vercel Serverless / Nitro)"]
        AttendanceAPI["POST /api/attendance"]
        NetworkAPI["GET /api/wifi-status"]
        AdminAPI["/api/admin/* (Staff, Face-Requests, Audit)"]
        AuthMiddleware["HMAC-SHA256 Token Verification"]
    end

    subgraph DatabaseLayer["Database Cluster (Supabase PostgreSQL)"]
        StaffTable["public.staff (Metadata & Status)"]
        AttendanceTable["public.attendance_records (Immutable Punch Log)"]
        SecurityEvents["public.security_events (Audit & Tokens)"]
        RPC["atomic_consume_face_approval_token() RPC"]
    end

    Camera --> UI
    UI --> FaceEngine
    FaceEngine --> PAD
    PAD --> Liveness
    Liveness --> Bridge
    Bridge --> Keystore
    Keystore --> RoomDB

    UI --> WifiAP
    WifiAP --> Egress
    UI --> AttendanceAPI
    AttendanceAPI --> AuthMiddleware
    AuthMiddleware --> StaffTable
    AuthMiddleware --> AttendanceTable
    AuthMiddleware --> SecurityEvents
    AdminAPI --> RPC
    RPC --> SecurityEvents
```

---

## 2. End-to-End System Component Architecture

The physical system consists of three distinct processing zones:

### 2.1 Native Android Shell (`com.campusattend.biometric`)
- **Container:** Kotlin-based Android application utilizing an optimized hardware-accelerated `WebView`.
- **Bridge Ingestion:** Injects `AndroidBiometricBridge` via `@JavascriptInterface` into the JavaScript execution runtime (`window.AndroidBiometricBridge`).
- **Hardware Cryptography:** `BiometricKeystoreManager` generates an asymmetric/symmetric master key inside the Android Keystore provider (`AndroidKeyStore`). Key material is permanently isolated inside hardware security modules (ARM TrustZone / StrongBox Keymaster) and cannot be extracted even by rooted devices.
- **Local Storage:** SQLite database encrypted via SQLCipher (`net.zetetic:android-database-sqlcipher:4.5.4`), storing 5 registered template slots per staff member.

### 2.2 Client Web Application (`src/`)
- **Application Engine:** TanStack Start (`@tanstack/react-start`) and TanStack Router running React 19.
- **Biometric Inference Pipeline:** `onnxruntime-web` (WebAssembly with SIMD) executing InsightFace MobileFaceNet (`w600k_mbf.onnx`) and MiniFASNet-V2 (`MiniFASNetV2.onnx`).
- **Vision Preprocessing:** `face-api.js` SSD MobileNet V1 face detection and 68-point landmark tracker.
- **Dynamic Viewport:** Full-screen responsive authentication modal (`FaceScanDialog.tsx`) wrapped in Radix UI `DialogContent` with `fullScreen={true}` and dynamic `100dvh` viewport sizing.

### 2.3 Serverless Compute & Cloud Storage
- **Runtime:** Vercel Serverless Functions running Node.js 24 and Nitro.
- **Database:** Supabase managed PostgreSQL 15 with Row Level Security (RLS) policies and `pgvector` extension.
- **Cryptographic Gatekeepers:** All attendance requests require server verification of client public egress IP addresses and cryptographic session tokens minted with HMAC-SHA256.

```mermaid
flowchart LR
    subgraph Client["Android Native Client"]
        WV[WebView Display]
        JSB[AndroidBiometricBridge.kt]
        BKM[BiometricKeystoreManager.kt]
        KS[(AndroidKeyStore)]
        SQL[(SQLCipher DB)]
    end

    subgraph BrowserEngine["Browser Runtime"]
        FSD[FaceScanDialog.tsx]
        AFE[arcface-engine.ts]
        HPE[head-pose.ts]
        LVE[liveness-engine.ts]
        PADS[anti-spoof-service.ts]
        ONNX[onnxruntime-web WASM]
    end

    subgraph Backend["Vercel Nitro Backend"]
        ATT[api/attendance.ts]
        STF[api/staff/face/index.ts]
        ADM[api/admin/face-requests/index.ts]
    end

    subgraph CloudDB["Supabase PostgreSQL"]
        PG_ATT[(attendance_records)]
        PG_SEC[(security_events)]
        PG_STF[(staff)]
    end

    WV <--> FSD
    FSD --> AFE & HPE & LVE & PADS
    AFE & PADS --> ONNX
    FSD <--> JSB
    JSB <--> BKM
    BKM <--> KS
    JSB <--> SQL
    FSD --> ATT
    ATT --> PG_ATT & PG_SEC & PG_STF
    ADM --> PG_SEC
```

---

## 3. Face Enrollment Workflow

Initial enrollment establishes the baseline biometric identity for a registered staff member. To ensure robust recognition across environmental variations without compromising privacy, CampusAttend implements a multi-angle burst enrollment workflow executed entirely on the local device.

```mermaid
sequenceDiagram
    autonumber
    actor Staff as Staff Member
    participant UI as FaceEnrollmentPage (Web)
    participant Video as Camera Feed
    participant Tracker as Face Landmarker (68 pts)
    participant Engine as ArcFace Engine (WASM)
    participant Bridge as AndroidBiometricBridge
    participant Keystore as Android Keystore
    participant DB as Local SQLCipher

    Staff->>UI: Launch Face Enrollment (/face-enrollment)
    UI->>Video: Request Front Camera (720x720)
    Video-->>UI: Live Stream Active
    UI->>Staff: Instruction: "Look directly at the camera (Frontal Pose)"
    
    loop Burst Capture (5 Diverse Frames)
        UI->>Tracker: Detect Face & Extract 68 Landmarks
        Tracker-->>UI: Landmarks (Pts 0..67, Bounding Box)
        UI->>Engine: Umeyama 5-Point Affine Warp to 112x112
        Engine-->>UI: Planar RGB Tensor [1, 3, 112, 112]
        UI->>Engine: Run MobileFaceNet (w600k_mbf.onnx)
        Engine-->>UI: 512-D L2-Normalized Embedding Vector
        UI->>Staff: Prompt next angle: "Tilt slightly left / right / smile"
    end

    Note over UI,Bridge: 5 Embeddings Generated (Slots 1 to 5)
    UI->>Bridge: enrollFace(staffId, JSON.stringify(embeddings))
    Bridge->>Keystore: Get/Create Master Key (AES-256-GCM)
    Keystore-->>Bridge: Master Key Handle
    
    loop For each template (1 to 5)
        Bridge->>Keystore: Encrypt 512 Floats with AAD ("staffId:deviceId")
        Keystore-->>Bridge: Ciphertext (2048 bytes) + 12-byte IV + GCM Tag
        Bridge->>DB: Store encrypted template record (Slot N, version 1)
    end

    Bridge-->>UI: Return NativeEnrollResult (success: true, count: 5)
    UI->>Staff: "Face Biometrics Enrolled & Hardware-Protected!"
```

---

## 4. Face Re-Enrollment & Single-Approval Lifecycle

To prevent unauthorized template swapping (e.g. an employee attempting to enroll a colleague's face to enable proxy attendance), CampusAttend implements an administrator-supervised re-enrollment lifecycle. Once enrolled, biometric slots are cryptographically locked. Any modification requires an administrative ticket and an atomic cryptographic token consumption process.

```mermaid
sequenceDiagram
    autonumber
    actor Staff as Staff Member
    participant App as CampusAttend App
    participant Bridge as Native Android Bridge
    actor Admin as Administrator
    participant Portal as Admin Portal (/admin/face-requests)
    participant Server as Backend API (/api/admin)
    participant DB as Supabase PostgreSQL

    Staff->>App: Request Face Replacement
    App->>Server: POST /api/staff/face (Reason: "Changed appearance / glasses")
    Server->>DB: INSERT INTO security_events (event: "Face Re-enrollment Requested", status: "pending")
    DB-->>Server: Request Recorded (ID: req_uuid)
    Server-->>App: Request Pending Supervisor Approval

    Admin->>Portal: Review Face Requests
    Portal->>Server: GET /api/admin/face-requests
    Server-->>Portal: List Pending Requests
    Admin->>Portal: Click "Approve Request"
    Portal->>Server: POST /api/admin/face-requests (action: "approve", requestId: req_uuid)
    
    Note over Server: Generate 24-Hour Cryptographic Token<br/>token = crypto.randomBytes(32).toString('hex')<br/>expiresAt = NOW() + 24 hours
    Server->>DB: UPDATE security_events SET device = 'token:XYZ|status:approved|expires_at:TS'
    DB-->>Server: Approval Recorded
    Server-->>Portal: Approval Token Generated

    Staff->>App: Open Face Re-Enrollment Screen
    App->>Server: Check Approval Status (GET /api/staff/face)
    Server-->>App: Status: Approved (Token: XYZ, Valid: 24h)
    
    App->>App: Capture 5 New Face Embeddings (Staged Replacement)
    App->>Bridge: stageReplacement(staffId, newEmbeddings)
    Bridge->>Bridge: Encrypt & Store in Staged Buffer (Version 2)
    Bridge-->>App: Staged Ready

    App->>Server: POST /api/staff/face (action: "commit", token: XYZ)
    Server->>DB: SELECT atomic_consume_face_approval_token(staffId, token, deviceId)
    
    Note over DB: Database Row Lock: SELECT ... FOR UPDATE<br/>Verify token matches & status == 'approved'<br/>Verify NOW() <= expires_at (Fail-closed)<br/>UPDATE status = 'consumed'
    
    DB-->>Server: JSON { success: true, code: "TOKEN_CONSUMED" }
    Server-->>App: HTTP 200: Replacement Authorized
    App->>Bridge: commitReplacement(staffId)
    Bridge->>Bridge: Promote Staged Buffer to Active Slots (Version 2)
    Bridge->>Bridge: Purge Version 1 Templates
    Bridge-->>App: Success: Active Templates Replaced
    App->>Staff: "Biometrics Updated Successfully!"
```

---

## 5. Live Attendance Verification & 3-Factor Gating

Attendance marking is governed by a strict sequential pipeline that terminates immediately upon failure of any gate:

```mermaid
flowchart TD
    Start([User Taps 'Mark Attendance']) --> Gate1{Factor 1: Wi-Fi Check}
    
    Gate1 -- "SSID ≠ sona & Egress IP Unauthorized" --> FailWifi[Show: 'Connect to SONA-WIFI Campus Network']
    Gate1 -- "SSID contains 'sona' OR Egress IP Matched" --> Gate2{Factor 2: GPS Geofence}
    
    Gate2 -- "Acquiring GPS / Accuracy > 50m" --> WaitGPS[Kalman Filter Warming Up... Reposition]
    Gate2 -- "Point Outside 19-Vertex Polygon" --> FailGeo[Show: 'Outside Campus Geofence Boundary']
    Gate2 -- "Point Inside Polygon" --> OpenDialog[Open Full-Screen FaceScanDialog]

    OpenDialog --> LoadModels[Load ArcFace & MiniFASNet ONNX Models]
    LoadModels --> CamStream[Start Front Camera Stream 720x720]
    CamStream --> DetectFace{Detect Face in Frame}

    DetectFace -- "No Face / Multiple Faces" --> Reposition[HUD: 'Position exactly 1 face in frame']
    Reposition --> DetectFace

    DetectFace -- "1 Valid Face Detected" --> Step1[Step 1 of 2: Face Identity Match]
    
    Step1 --> UmeyamaWarp[Umeyama 5-Pt Alignment to 112x112]
    UmeyamaWarp --> ArcFaceInfer[ArcFace 512-D Neural Inference]
    ArcFaceInfer --> BridgeMatch[Android Keystore Native Matching]
    BridgeMatch --> CosineCheck{Cosine Distance ≤ 0.45?}

    CosineCheck -- "Distance > 0.45" --> TryMirror{Mirrored Tensor ≤ 0.45?}
    TryMirror -- "No (Mismatch)" --> FailMatch[HUD: 'Face not recognized. Try again.']
    FailMatch --> DetectFace
    
    CosineCheck -- "Yes (Matched)" --> Step2[Step 2 of 2: Liveness & PAD]
    TryMirror -- "Yes (Matched)" --> Step2

    Step2 --> PADCheck[MiniFASNet-V2 80x80 BGR Inference + Optical Filters]
    PADCheck --> PADDecision{Live Score ≥ 70% & Glare < 22% & Moire < 45%?}
    PADDecision -- "Spoof Detected" --> FailPAD[HUD: 'Presentation attack detected']
    
    PADDecision -- "Passed" --> HeadPose[Select 1 Random Movement from 4 Choices]
    HeadPose --> ActionPrompt[Prompt: 'Turn Left / Right / Tilt Up / Down']
    
    ActionPrompt --> PoseTrack{Pose Satisfied for 3 Consecutive Frames?}
    PoseTrack -- "Timeout (>10s) / Inconclusive" --> RetryPose[Allow up to 2 Retries]
    RetryPose --> ActionPrompt
    
    PoseTrack -- "Verified" --> PostAPI[POST /api/attendance with Nonce & Token]
    PostAPI --> ServerVerify{Server Validations}
    
    ServerVerify -- "Duplicate Punch / Invalid Token" --> ServerFail[HTTP 409 / 403 Error]
    ServerVerify -- "All Passed" --> RecordDB[(Write to public.attendance_records)]
    RecordDB --> Success([Attendance Successfully Marked! ✓])
```

---

## 6. Single-Action Randomized Head Movement State Machine

The active liveness challenge enforces human response to a real-time prompt generated with a cryptographic nonce. Nodding and blinking have been completely eliminated. The state machine strictly selects from four orthogonal directional movements:

```mermaid
stateDiagram-v2
    [*] --> Idle: Dialog Opened
    Idle --> Calibrating: Step 1 Face Identity Matched
    
    Calibrating --> SelectingAction: 5 Stable Neutral Frames Captured (Baseline Yaw, Pitch)
    
    SelectingAction --> ActionActive: Random Selection (P=0.25 each)\n1. TURN_LEFT (ΔYaw ≥ +14°)\n2. TURN_RIGHT (ΔYaw ≤ -14°)\n3. LOOK_UP (ΔPitch ≥ +9°)\n4. LOOK_DOWN (ΔPitch ≤ -9°)
    
    state ActionActive {
        [*] --> TrackingMovement: Display Instruction & 10s Timer
        TrackingMovement --> RepositioningPrompt: Face Tracking Lost (Transient Noise)
        RepositioningPrompt --> TrackingMovement: Face Reacquired
        TrackingMovement --> FrameAccumulation: Current Pose Angle Crosses Threshold
        FrameAccumulation --> TrackingMovement: Pose Angle Drops Below Threshold (Jitter Reset)
        FrameAccumulation --> MovementConfirmed: 3 Consecutive Stable Frames Satisfied
    }
    
    ActionActive --> AttemptTimeout: 10 Seconds Expired Without Satisfied Pose
    AttemptTimeout --> ActionActive: Retry Attempt (Max 2 Retries)
    AttemptTimeout --> Failed: Retries Exhausted (Liveness Failed)

    MovementConfirmed --> Passed: Generate Cryptographic Nonce & Attestation Evidence
    Passed --> [*]: Advance to Server Attendance POST
    Failed --> [*]: Reset Camera & Allow Manual Retry
```

### Pose Coordinate Conventions & Angle Equations:
1. **Yaw Calculation ($\Delta\text{Yaw}$):**
   $$\text{offset} = \frac{X_{\text{nose\_tip}} - \frac{X_{\text{left\_edge}} + X_{\text{right\_edge}}}{2}}{\frac{|X_{\text{right\_edge}} - X_{\text{left\_edge}}|}{2}}$$
   $$\text{Yaw} = \text{offset} \times 45.0^\circ$$
   - Physical Turn LEFT: Nose shifts toward landmark 16 $\rightarrow \Delta\text{Yaw} \ge +14.0^\circ$.
   - Physical Turn RIGHT: Nose shifts toward landmark 0 $\rightarrow \Delta\text{Yaw} \le -14.0^\circ$.
2. **Pitch Calculation ($\Delta\text{Pitch}$):**
   $$\text{Ratio} = \frac{Y_{\text{nose\_tip}} - Y_{\text{nose\_bridge}}}{Y_{\text{chin}} - Y_{\text{nose\_tip}}}$$
   $$\text{Pitch} = (\text{Ratio} - 0.60) \times 70.0^\circ$$
   - Physical Tilt UP: Upper nose compresses vertically $\rightarrow \Delta\text{Pitch} \ge +9.0^\circ$.
   - Physical Tilt DOWN: Upper nose lengthens $\rightarrow \Delta\text{Pitch} \le -9.0^\circ$.

---

## 7. Presentation Attack Detection (PAD) Pipeline

To counter physical presentation attacks without adding latency, CampusAttend fuses deep neural network inference with multi-spectral optical heuristic analyzers:

```mermaid
flowchart TD
    Frame[Live Camera Video Frame] --> Crop1[128x128 Face ROI Crop]
    Frame --> Crop2[80x80 BGR 2.7x Extended Bounding Box]

    subgraph OpticalAnalyzers["Layer 1: Optical Heuristic Analyzers"]
        Crop1 --> Moire[High-Frequency Moire Energy\nLaplacian Kernel Edge Derivative]
        Crop1 --> Glare[Specular Screen Glare Ratio\nPlanar Glass Luminance > 248]
        Crop1 --> Gamut[Color Gamut Dynamic Range\nRGB Variance & Saturation Histogram]
        Crop1 --> Motion[Temporal Motion Variance\nPixel History Matrix Buffer N=8]
    end

    subgraph NeuralAnalyzer["Layer 2: MiniFASNet-V2 Deep Neural Network"]
        Crop2 --> PlanarTensor[Planar Float32 Array [1, 3, 80, 80]\nRaw BGR Pixels in [0..255] Range]
        PlanarTensor --> WASMInference[onnxruntime-web WASM Session]
        WASMInference --> RawLogits[Raw Output Logits: [1, 3]]
        RawLogits --> Softmax[Softmax Function]
        Softmax --> Classes[Class 0: Print Attack Score\nClass 1: Live Real Face Score\nClass 2: Screen Replay Score]
    end

    subgraph DecisionFusion["Layer 3: Decision Fusion & Risk Weighting"]
        Moire & Glare & Gamut & Motion --> HeuristicScore[Aggregate Optical Risk Score]
        Classes --> NeuralScore[Neural Live Probability]
        HeuristicScore & NeuralScore --> PolicyCheck{Enforce Security Policy:\nLive Score ≥ 70%\nGlare Ratio < 22%\nMoire Energy < 45%\nTemporal Motion Variance ≥ 0.8}
    end

    PolicyCheck -- "Violated" --> RejectSpoof[REJECT: Presentation Attack Detected]
    PolicyCheck -- "Satisfied" --> AcceptLive[PASS: Genuine Human Presentation Verified]
```

---

## 8. Kalman Filter & Ray-Casting Geofence Pipeline

To prevent attendance marking outside campus grounds, raw device coordinates undergo real-time noise reduction before rigorous point-in-polygon boundary evaluation:

```mermaid
flowchart TD
    GPS[HTML5 Geolocation API / Android FusedLocationProviderClient] --> RawCoord[Raw Coordinate: Lat_m, Lng_m, Accuracy_m]
    
    subgraph KalmanFilter["1D Discrete Kalman Filter (Lat & Lng)"]
        RawCoord --> Predict[Time Update: State Prediction & Covariance Extrapolation]
        Predict --> Gain[Compute Kalman Gain: K = P_pred / (P_pred + R)]
        Gain --> Correct[Measurement Update: Estimate = Prev + K * (Measured - Prev)]
        Correct --> UpdateCov[Covariance Update: P = (1 - K) * P_pred]
        UpdateCov --> FilteredCoord[Smoothed Coordinate: Lat_f, Lng_f]
    end

    subgraph GeofenceEvaluator["Ray-Casting Algorithm (Jordan Curve Theorem)"]
        FilteredCoord --> Polygon[19-Vertex Sona College Polygon Boundary]
        Polygon --> RayCast[Cast Horizontal Ray (Y = Lat_f, X > Lng_f)]
        RayCast --> IntersectLoop[Loop Over 19 Polygon Edges C_i -> C_j]
        IntersectLoop --> CrossingCount{Count Ray-Edge Intersections}
        CrossingCount -- "Odd Number of Crossings" --> Inside[Result: INSIDE CAMPUS]
        CrossingCount -- "Even Number of Crossings" --> Outside[Result: OUTSIDE CAMPUS]
    end

    subgraph DistanceCalculators["Haversine Metric Analyzers"]
        FilteredCoord --> CentroidDist[Great-Circle Distance to Campus Centroid: 11.67698, 78.12535]
        FilteredCoord --> BoundaryDist[Perpendicular Distance to Nearest Polygon Edge]
    end

    Inside --> GatingDecision{Accuracy ≤ 50m & Inside == true}
    Outside --> BlockAttendance[Block: Geofence Gate Failed]
    GatingDecision -- "True" --> PermitAttendance[Permit: Geofence Gate Passed]
    GatingDecision -- "False" --> BlockAttendance
```

---

## 9. Security, Trust Boundaries & Cryptographic Data Flows

The following diagram defines the physical and cryptographic boundaries separating client-controlled memory from trusted execution environments:

```mermaid
flowchart TD
    subgraph UntrustedZone["Untrusted Client Memory (Browser / DOM)"]
        WebDOM[DOM Tree & JS Variables]
        DevTools[Chrome DevTools / Inspector]
        SpoofGPS[Mock Location Applications]
    end

    subgraph TrustedAndroidZone["Trusted Hardware Zone (Android OS)"]
        KeystoreModule[Android Keystore / ARM TrustZone]
        CryptoBridge[AndroidBiometricBridge Native Code]
        SQLCipherStorage[Encrypted SQLite Database]
    end

    subgraph NetworkBoundary["Network Security Boundary"]
        TLS[TLS 1.3 / HTTPS Encryption]
        HMAC[Cryptographic Session Signatures]
        EgressIP[Campus ISP Egress Subnet]
    end

    subgraph TrustedCloudZone["Trusted Cloud Infrastructure (Vercel & Supabase)"]
        AttendanceFunction[Vercel Serverless Function: api/attendance]
        SupabaseDB[PostgreSQL Database with RLS Policies]
        AuditLog[Immutable Audit Trail]
    end

    WebDOM -. "Tampering Attempt" .-> DevTools
    DevTools -. "Blocked by AAD & Keystore" .-> KeystoreModule
    SpoofGPS -. "Filtered by Kalman & Server Egress" .-> AttendanceFunction

    CryptoBridge <--> KeystoreModule
    CryptoBridge <--> SQLCipherStorage
    CryptoBridge --> HMAC

    WebDOM --> TLS
    TLS --> AttendanceFunction
    HMAC --> AttendanceFunction
    EgressIP --> AttendanceFunction

    AttendanceFunction --> SupabaseDB
    AttendanceFunction --> AuditLog
```

### Trust Boundary Rules:
1. **Zero Client Trust on Attendance Authorization:** The serverless handler `api/attendance.ts` never trusts boolean flags passed by the client (such as `wifiAuthorized: true` or `geofencePassed: true`). The server independently recalculates the ray-casting algorithm on the submitted GPS coordinates and independently validates the network session token or caller egress IP.
2. **Biometric Data Non-Exfiltration:** Plaintext embeddings and face crops exist solely within volatile memory during inference and are garbage-collected immediately. Persistent templates are locked in hardware-bound ciphertext with Authenticated Additional Data (`$staffId:$deviceId`).
3. **Replay Protection:** Attendance submissions require an `attemptNonce` issued by the liveness engine and validated against recent audit logs to prevent replaying recorded HTTP packets.

---

## 10. Production Cloud & Android Native Deployment Architecture

The following diagram maps the production deployment topology linking Git, Vercel, Supabase, and client mobile devices:

```mermaid
flowchart TD
    subgraph GitRepo["Source Control (GitHub)"]
        MainBranch[Branch: main\nCommit: aa65c83]
        LovableSync[Lovable.dev Bidirectional Sync]
    end

    subgraph VercelCI["Vercel Cloud CI/CD Pipeline"]
        Webhook[GitHub Deployment Webhook]
        ViteBuild[Vite 8.2 + Nitro Build]
        StaticDeploy[Edge CDN: Static Assets, WASM, ONNX Models]
        ServerlessDeploy[Edge Compute: Node.js Serverless Functions]
    end

    subgraph SupabaseCloud["Supabase Managed Database"]
        PostgresInstance[PostgreSQL 15 Instance (AWS ap-south-1)]
        PgVectorInst[pgvector Extension]
        RLSInst[Row Level Security Engine]
    end

    subgraph AndroidBuild["Android Native Packaging"]
        GradleBuild[Android Gradle Plugin 8.2.0 + Kotlin 1.9.22]
        ProGuard[R8 Code Shrinker & Resource Optimizer]
        APK[Compiled APK: app-debug.apk (162 MB)]
    end

    subgraph UserDevices["End-User Client Devices"]
        MobileApp[CampusAttend Native App (WebView Shell)]
        MobileBrowser[Chrome / Safari Web Browser]
    end

    MainBranch --> Webhook
    MainBranch <--> LovableSync
    Webhook --> ViteBuild
    ViteBuild --> StaticDeploy & ServerlessDeploy
    
    ServerlessDeploy <--> PostgresInstance
    PostgresInstance --- PgVectorInst & RLSInst

    MainBranch --> GradleBuild
    GradleBuild --> ProGuard
    ProGuard --> APK
    APK --> MobileApp

    StaticDeploy --> MobileApp & MobileBrowser
    ServerlessDeploy --> MobileApp & MobileBrowser
```
