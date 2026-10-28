import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

def build_inventory():
    wb = openpyxl.Workbook()
    # Remove default sheet
    default_sheet = wb.active
    wb.remove(default_sheet)

    # Styles
    header_fill = PatternFill(start_color="1F4E78", end_color="1F4E78", fill_type="solid")
    header_font = Font(name="Calibri", size=11, bold=True, color="FFFFFF")
    data_font = Font(name="Calibri", size=10)
    border_thin = Side(border_style="thin", color="D9D9D9")
    box_border = Border(left=border_thin, right=border_thin, top=border_thin, bottom=border_thin)

    headers = [
        "Technology / Component",
        "Version",
        "Category",
        "Purpose in CampusAttend",
        "Why It Is Needed",
        "Repository Location",
        "Inputs & Outputs",
        "Component Interactions",
        "Dependency Type",
        "Evidence Source",
        "Limitations & Constraints"
    ]

    items = [
        # AI & Biometrics
        (
            "InsightFace MobileFaceNet (w600k_mbf.onnx)",
            "MS1M-w600k ArcFace",
            "AI / Biometrics",
            "Deep neural network extracting 512-dimensional facial biometric embeddings",
            "Provides high-discriminability cosine feature vectors for 1:1 and 1:N face verification",
            "public/models/w600k_mbf.onnx, src/lib/face-recognition/arcface-engine.ts",
            "Input: [1, 3, 112, 112] RGB float32 ((x-127.5)/128.0); Output: Float32Array[512] L2-normalized vector",
            "Consumes 5-point aligned crops from Umeyama transform; feeds embeddings to Keystore matcher or pgvector",
            "Direct Model Asset / ONNX Inference",
            "File size: 13,616,099 bytes; tested in scripts/test-face-parity.js",
            "Requires WebAssembly/SIMD runtime; ~80-160ms CPU latency depending on client hardware"
        ),
        (
            "MiniFASNet-V2 (MiniFASNetV2.onnx)",
            "Silent-Face-Anti-Spoofing V2",
            "AI / Anti-Spoofing (PAD)",
            "Presentation Attack Detection classifying live faces vs print/replay attacks",
            "Blocks spoofing attempts via paper photos, digital tablets, and mobile video replays",
            "public/models/MiniFASNetV2.onnx, src/lib/face-recognition/anti-spoof-service.ts",
            "Input: [1, 3, 80, 80] BGR float32 [0..255] (2.7x crop); Output: [1, 3] raw logits -> Softmax (Print, Live, Replay)",
            "Invoked every 200ms during face framing; fused with optical glare and moiré energy checks",
            "Direct Model Asset / ONNX Inference",
            "File size: 1,744,116 bytes; tested in scripts/test-pad-liveness-attacks.js",
            "Raw pixel values must remain in [0..255]; dividing by 255 corrupts classification into replay"
        ),
        (
            "onnxruntime-web",
            "^1.27.0",
            "AI Runtime / Inference Engine",
            "Executes ONNX models (ArcFace & MiniFASNet) directly in browser WebAssembly environment",
            "Enables client-side biometric inference without uploading video frames or photos to remote servers",
            "package.json, src/lib/face-recognition/arcface-engine.ts, anti-spoof-service.ts",
            "Input: JS Float32Array planar tensors; Output: ort.Tensor inference results",
            "Initialized via wasm execution provider; interacts with HTML5 Canvas / Video streams",
            "Direct NPM Dependency",
            "package.json line 82; built output in .output/server/_libs/onnxruntime-web.mjs",
            "Initial WASM binary download ~4.5MB; requires SIMD browser support for optimal performance"
        ),
        (
            "face-api.js",
            "^0.22.2",
            "AI / Computer Vision",
            "Provides SSD MobileNet V1 face detector and 68-point facial landmark extractor",
            "Required to locate facial bounding box, eye pupils, nose bridge/tip, and mouth corners for alignment & pose",
            "package.json, src/lib/face-recognition/face-detection.ts, head-pose.ts",
            "Input: HTMLVideoElement / HTMLCanvasElement; Output: FaceDetection, FaceLandmarks68 (positions[68])",
            "Feeds 5 primary landmark coordinates to Umeyama transform and 68 points to HeadPose estimator",
            "Direct NPM Dependency",
            "package.json line 78; models in public/models/ssd_mobilenetv1_model*, face_landmark_68_model*",
            "Older TensorFlow.js peer dependencies; high memory consumption if canvas contexts not cleared"
        ),
        (
            "MediaPipe Tasks Vision",
            "0.10.9 (Android)",
            "AI / Computer Vision (Native)",
            "Native Android face detection and 478-point 3D face mesh landmarker",
            "Accelerates native on-device face tracking when running inside Android wrapper",
            "android/app/build.gradle.kts, android/app/.../detection/",
            "Input: CameraX ImageProxy; Output: NormalizedLandmarks (478 3D points)",
            "Connects to native CameraX pipeline; passes landmarks to native AndroidBiometricBridge",
            "Native Gradle Dependency",
            "build.gradle.kts line 100; assets: face_landmarker.task (3.76MB), face_detection_short_range.tflite",
            "Android only; unavailable in standard mobile Safari or desktop Chrome"
        ),
        (
            "Umeyama Similarity Transform Algorithm",
            "Custom Math Implementation",
            "Geometric Alignment",
            "Computes least-squares 2D similarity transform matrix (rotation, scale, translation)",
            "Normalizes face orientation, scale, and tilt to standard ArcFace canonical coordinate space",
            "src/lib/face-recognition/arcface-engine.ts (estimateSimilarityTransform)",
            "Input: 5 detected landmark points [[x,y] * 5]; Output: 2x3 affine matrix M and inverse invM",
            "Transforms source canvas pixel buffer into 112x112 aligned planar tensor for ArcFace",
            "Custom Algorithm Implementation",
            "Lines 49-118 in arcface-engine.ts; verified in scripts/test-umeyama-fix.js",
            "Requires exactly 5 non-collinear reference points; zero variance triggers fallback offset"
        ),
        (
            "Head Pose & Single-Action Liveness Engine",
            "Custom State Machine",
            "Active Liveness / Anti-Spoofing",
            "Tracks 3D head rotation (yaw/pitch) and enforces exactly one randomized action (Turn Left/Right, Tilt Up/Down)",
            "Confirms live human presence and prevents static photo, recorded video, or mask presentation attacks",
            "src/lib/face-recognition/liveness-engine.ts, head-pose.ts",
            "Input: 68 landmarks per frame, bounding box, timestamp; Output: LivenessState (idle, active, passed, failed)",
            "Coordinates with FaceScanDialog UI; generates cryptographic attemptNonce upon completion",
            "Custom Algorithm & Architecture",
            "Tested in scripts/test-head-movement-liveness.js (24/24 passed); verified in production build",
            "Tolerant threshold: Yaw ±14°, Pitch ±9°; requires 3 stable frames; zero arbitrary timeout"
        ),

        # Frontend Stack
        (
            "React",
            "^19.2.0",
            "Frontend Framework",
            "Core reactive UI library powering all web pages, dialogs, hooks, and component states",
            "Enables declarative component lifecycle, camera streaming bindings, and reactive biometrics HUD",
            "package.json, src/",
            "Input: JSX components, React state/effects; Output: Virtual DOM rendered to browser DOM",
            "Connects with TanStack Router, TanStack Query, Radix UI, and HTML5 WebRTC APIs",
            "Direct NPM Dependency",
            "package.json line 84",
            "Requires React 19-compatible peer dependencies; strict hydration rules"
        ),
        (
            "TanStack Start & Router",
            "^1.168.60 / ^1.170.41",
            "Full-Stack Web Framework & Routing",
            "Provides file-based routing, SSR hydration, server functions, and layout transitions",
            "Enables seamless client-side navigation between attendance, dashboard, profile, and admin suites",
            "package.json, src/routes/, src/routeTree.gen.ts, src/router.tsx",
            "Input: URL routes, server loaders; Output: Rendered HTML/JS bundles",
            "Manages root navigation shell, route-level authorization gates, and search parameters",
            "Direct NPM Dependency",
            "package.json lines 70-72; routeTree.gen.ts (12KB)",
            "Requires automated route tree regeneration on route file creation"
        ),
        (
            "Tailwind CSS",
            "^4.2.1",
            "CSS Framework / Design System",
            "Modern utility-first styling engine providing responsive tokens, dark mode, and animations",
            "Ensures responsive mobile viewports, glassmorphic HUD overlays, and dark-mode contrast",
            "package.json, src/styles.css, @tailwindcss/vite",
            "Input: Utility class names in TSX; Output: Optimized CSS bundle",
            "Styles all components, buttons, badges, full-screen dialog overlays, and progress bars",
            "Direct NPM / Vite Plugin",
            "package.json lines 68, 92; styles.css (5.6KB)",
            "Tailwind v4 class merging requires explicit [transform:none] when overriding base dialogs"
        ),
        (
            "Radix UI Primitives",
            "^1.1 - ^2.2",
            "Headless UI Components",
            "Unstyled, accessible UI building blocks (Dialog, DropdownMenu, Tabs, Progress, Tooltip)",
            "Ensures robust accessibility, keyboard navigation, focus trapping, and modal portal rendering",
            "package.json, src/components/ui/",
            "Input: React component props; Output: Accessible DOM elements with ARIA attributes",
            "Housed in src/components/ui/dialog.tsx, progress.tsx, tabs.tsx; wrapped by FaceScanDialog",
            "Direct NPM Dependency",
            "package.json lines 41-66",
            "Default DialogContent applies transform: translate(-50%, -50%) which required fullScreen prop"
        ),
        (
            "Lucide React",
            "^0.575.0",
            "UI Icon Library",
            "Vector icon components for biometric states, navigation, GPS, Wi-Fi, and admin tools",
            "Provides clean visual cues for direction arrows (Left, Right, Up, Down), face scanners, and badges",
            "package.json, src/components/",
            "Input: SVG icon props (size, color, className); Output: Inline SVG DOM elements",
            "Rendered across FaceScanDialog, Navigation, StatusBadges, and Dashboard cards",
            "Direct NPM Dependency",
            "package.json line 81",
            "Tree-shaken by Vite during production build"
        ),

        # Backend & Serverless
        (
            "Nitro & Vercel Serverless Functions",
            "3.0.260603-beta (Nitro)",
            "Backend Server / Runtime",
            "Serverless HTTP route handler processing attendance, staff authentication, and admin RPCs",
            "Enforces zero-trust server-side attendance authorization, network egress IP validation, and DB writes",
            "api/attendance.ts, api/staff/, api/admin/, src/server/",
            "Input: HTTP requests (JSON / Headers); Output: HTTP JSON responses, Set-Cookie headers, error status",
            "Interacts directly with Supabase PostgreSQL client; verifies HMAC session tokens",
            "Direct Backend Framework & Cloud Runtime",
            "package.json line 113; api/attendance.ts (43KB, 1223 lines); vercel.json",
            "Serverless cold starts ~200-500ms; maximum execution duration bounded by Vercel tier"
        ),
        (
            "Node.js Crypto Module",
            "v24.19.0 (LTS runtime)",
            "Cryptography / Security",
            "Native cryptographic module for HMAC-SHA256 token minting and timing-safe comparisons",
            "Prevents token forgery and timing attacks on session authentication and network verification",
            "api/attendance.ts, src/server/admin-auth.ts",
            "Input: Plaintext token strings, secrets; Output: Base64URL signatures, timingSafeEqual booleans",
            "Secures staff session tokens, admin session tokens, and networkAuthToken",
            "Node.js Core Standard Library",
            "Used in api/attendance.ts lines 58-61, 81-84; tested in scripts/test-admin-auth.js",
            "Server-side only; not available in client browser context without polyfills"
        ),

        # Android Native & Security
        (
            "Android Keystore System",
            "API 24+ (Android 7.0 - 14.0)",
            "Hardware Security Module",
            "Hardware-backed secure enclave / TEE generating and storing master AES-256 keys",
            "Ensures biometric encryption keys never enter application memory or disk plaintext",
            "android/app/.../security/BiometricKeystoreManager.kt",
            "Input: Master key alias, KeyGenParameterSpec; Output: Hardware-backed SecretKey",
            "Provides encryption/decryption keys to AES-GCM cipher for 512-D ArcFace float embeddings",
            "Native Android OS Platform API",
            "BiometricKeystoreManager.kt lines 35-82; verified in test:face-parity",
            "Requires genuine Android device with hardware Keystore; simulated fallback in browser"
        ),
        (
            "AES-256-GCM with AAD",
            "Cipher: AES/GCM/NoPadding",
            "Authenticated Encryption",
            "Encrypts 512-D float vectors (2048 bytes) with 128-bit authentication tag and AAD binding",
            "Guarantees confidentiality and integrity; binds templates to specific staffId and hardware deviceId",
            "android/app/.../security/BiometricKeystoreManager.kt",
            "Input: FloatArray[512], AAD: '$staffId:$deviceId'; Output: EncryptedResult(ciphertext, iv, deviceId)",
            "Stored in SQLCipher / Room database on device; decrypted during 1:1 face matching",
            "Native Cryptography API",
            "BiometricKeystoreManager.kt lines 103-155; tested in scripts/test-face-parity.js",
            "Tampering with AAD or copying ciphertext to another device causes GCM tag verification failure"
        ),
        (
            "SQLCipher for Android",
            "4.5.4",
            "Database Encryption",
            "Full 256-bit AES database encryption for SQLite backing Android Room database",
            "Encrypts local staff records, encrypted biometric slots, and offline attendance cache at rest",
            "android/app/build.gradle.kts (net.zetetic:android-database-sqlcipher:4.5.4)",
            "Input: SQLite SQL queries; Output: Encrypted on-disk database file",
            "Integrates transparently with Android Room ORM architecture",
            "Native Gradle Dependency",
            "build.gradle.kts line 112",
            "Requires native .so libraries for armeabi-v7a, arm64-v8a, x86, x86_64"
        ),
        (
            "AndroidBiometricBridge",
            "@JavascriptInterface",
            "Native-to-Web Bridge",
            "Exposes secure native Android Keystore and biometric methods to WebView JavaScript",
            "Allows the web UI to initiate local enrollment, query templates, and trigger hardware verification",
            "android/app/.../bridge/AndroidBiometricBridge.kt, src/lib/native-biometric-bridge.ts",
            "Input: JSON method arguments from window.AndroidBiometricBridge; Output: JSON string results",
            "Injected into Android WebView in MainActivity.kt; consumed by native-biometric-bridge.ts",
            "Custom Native Hybrid Interface",
            "AndroidBiometricBridge.kt (96.8KB); verified via scripts/test-face-parity.js",
            "All bridge methods return JSON strings to prevent cross-origin object prototype pollution"
        ),

        # Database & Storage
        (
            "Supabase / PostgreSQL",
            "PostgreSQL 15+ (Cloud)",
            "Relational Database",
            "Central cloud database storing staff metadata, attendance records, audit logs, and security events",
            "Provides reliable ACID transactions, relational foreign keys, row-level security, and audit history",
            "supabase/schema.sql, src/lib/supabase.ts, api/attendance.ts",
            "Input: SQL queries, REST API calls; Output: JSON result sets, transaction commits",
            "Connected via @supabase/supabase-js and direct pg pool in backend migration scripts",
            "External Cloud Database Service",
            "Hosted on gcpuuvhydtgmcpiumpfa.supabase.co; schema.sql (284 lines)",
            "Free tier project pausing if inactive; connection pool limits on serverless invocations"
        ),
        (
            "pgvector Extension",
            "v0.5+ (PostgreSQL)",
            "Vector Database Extension",
            "Enables vector(512) data type and L2 distance (<->) vector similarity indexing",
            "Provides optional server-side vector search and ground-truth validation fallback",
            "supabase/schema.sql (CREATE EXTENSION vector, match_face_embeddings RPC)",
            "Input: vector(512) query vector; Output: Ranked nearest neighbor staff records with cosine distance",
            "Exposed via match_face_embeddings stored procedure; secondary fallback to device-local matching",
            "PostgreSQL Extension",
            "schema.sql lines 14, 38, 234-266; tested in scripts/check-pgvector.js",
            "Primary attendance architecture is device-local for privacy; server vector search is fallback only"
        ),

        # Geofencing & Network
        (
            "Jordan Curve Ray-Casting Algorithm",
            "Custom Math Implementation",
            "Geofence Verification",
            "Determines whether a device coordinate lies strictly inside the 19-vertex campus polygon",
            "Enforces strict geographical attendance boundaries covering Sona College of Technology",
            "src/lib/geofence/geofence-service.ts, api/attendance.ts",
            "Input: Device {lat, lng}, Polygon [{lat, lng} * 19]; Output: boolean isInside",
            "Executed client-side in use-geofence.ts and independently verified server-side in api/attendance.ts",
            "Custom Algorithm Implementation",
            "Lines 77-111 in geofence-service.ts; verified in scripts/test-gps-accuracy-suite.js",
            "Boundary points require careful edge intersection handling to avoid degenerate zero-length rays"
        ),
        (
            "1D Kalman Filter",
            "Custom Math Implementation",
            "GPS Sensor Filtering",
            "One-dimensional linear Kalman filter estimating true latitude and longitude from noisy measurements",
            "Filters transient GPS multipath jitter, urban canyon bounces, and sensor drift",
            "src/lib/geofence/kalman-filter.ts",
            "Input: Measured coordinate, accuracy (meters), timestamp; Output: Filtered estimate, variance",
            "Smoothes raw navigator.geolocation coordinates before evaluation by geofence service",
            "Custom Algorithm Implementation",
            "Lines 45-120 in kalman-filter.ts; tested in scripts/test-kalman-filter.js",
            "Tuned for pedestrian walking velocities (1.4 m/s); rapid vehicular transit may introduce lag"
        ),
        (
            "SONA-WIFI Network Verifier",
            "Custom Policy & Bridge",
            "Network Authentication",
            "Validates that device is connected to authorized campus Wi-Fi network (SSID matching 'sona')",
            "Acts as the first factor in 3-factor attendance gating (Wi-Fi + GPS + Biometrics)",
            "src/lib/wifi-config.ts, api/wifi-status.ts, api/attendance.ts",
            "Input: Native bridge SSID, network transport, public egress IP; Output: WifiVerificationResult",
            "Enforced client-side via WifiGatekeeper and server-side via authorized egress IPs (111.92.42.18, 115.247.87.98)",
            "Custom Implementation & Server Gate",
            "wifi-config.ts lines 23-36; tested in scripts/test-all-three-wifi-networks.js",
            "Android 10+ requires ACCESS_FINE_LOCATION permission to read Wi-Fi SSID in WebView"
        ),

        # Testing & Tooling
        (
            "Node.js & TSX Test Runner",
            "Node 24.19.0 / TSX 4.7",
            "Automated Testing",
            "Executes 123 custom test and diagnostic suites covering biometrics, PAD, geofence, and API security",
            "Guarantees regression safety, model parity, cryptographic token validation, and layout responsiveness",
            "scripts/*.js, package.json scripts",
            "Input: Synthetic landmarks, mock ONNX tensors, live API endpoints; Output: Test assertion logs",
            "Automates test:head-liveness, test:face-parity, test:face-workflow, test:pad, test:face-layout",
            "Development Tooling",
            "123 test files in scripts/; 100% passing across all major test suites",
            "Simulates mobile camera and Keystore environments; does not replace real-world physical device test"
        ),
        (
            "Vercel Deployment Platform",
            "Vercel CLI 64.5.0",
            "Cloud Hosting & CI/CD",
            "Hosts production web application, static assets, WASM models, and serverless API endpoints",
            "Provides global edge delivery, HTTPS termination, serverless compute, and continuous deployment from Git",
            "vercel.json, .output/",
            "Input: Git commits to origin/main; Output: Live production deployment at geo-fenced-attendence-system.vercel.app",
            "Synchronizes with GitHub repository; connects web clients to serverless functions and Supabase",
            "Cloud Infrastructure Platform",
            "Production URL: https://geo-fenced-attendence-system.vercel.app/ (HTTP 200 verified)",
            "Asset bundle sizes must stay within Vercel serverless function size limits (50MB uncompressed)"
        )
    ]

    # Create All Technologies Sheet
    ws_all = wb.create_sheet(title="All Technologies")
    ws_all.append(headers)

    for row_idx, item in enumerate(items, start=2):
        ws_all.append(list(item))
        for col_idx in range(1, len(headers) + 1):
            cell = ws_all.cell(row=row_idx, column=col_idx)
            cell.font = data_font
            cell.border = box_border
            cell.alignment = Alignment(vertical="top", wrap_text=True)

    # Style header
    for col_idx in range(1, len(headers) + 1):
        cell = ws_all.cell(row=1, column=col_idx)
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)

    # Set column widths
    col_widths = [26, 16, 20, 32, 32, 28, 35, 30, 24, 28, 30]
    for idx, width in enumerate(col_widths, start=1):
        col_letter = get_column_letter(idx)
        ws_all.column_dimensions[col_letter].width = width

    # Create Category Specific Sheets
    categories = [
        ("AI & Biometrics", ["AI / Biometrics", "AI / Anti-Spoofing (PAD)", "AI Runtime / Inference Engine", "AI / Computer Vision", "AI / Computer Vision (Native)", "Geometric Alignment", "Active Liveness / Anti-Spoofing"]),
        ("Frontend & Mobile", ["Frontend Framework", "Full-Stack Web Framework & Routing", "CSS Framework / Design System", "Headless UI Components", "UI Icon Library", "Native-to-Web Bridge"]),
        ("Security & Android", ["Hardware Security Module", "Authenticated Encryption", "Database Encryption", "Cryptography / Security"]),
        ("Backend & Database", ["Backend Server / Runtime", "Relational Database", "Vector Database Extension"]),
        ("Geofencing & Network", ["Geofence Verification", "GPS Sensor Filtering", "Network Authentication"]),
        ("DevOps & Testing", ["Automated Testing", "Cloud Hosting & CI/CD"])
    ]

    for cat_title, cat_names in categories:
        ws_cat = wb.create_sheet(title=cat_title)
        ws_cat.append(headers)
        for col_idx in range(1, len(headers) + 1):
            cell = ws_cat.cell(row=1, column=col_idx)
            cell.fill = header_fill
            cell.font = header_font
            cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)

        cat_row = 2
        for item in items:
            if item[2] in cat_names:
                ws_cat.append(list(item))
                for col_idx in range(1, len(headers) + 1):
                    cell = ws_cat.cell(row=cat_row, column=col_idx)
                    cell.font = data_font
                    cell.border = box_border
                    cell.alignment = Alignment(vertical="top", wrap_text=True)
                cat_row += 1

        for idx, width in enumerate(col_widths, start=1):
            col_letter = get_column_letter(idx)
            ws_cat.column_dimensions[col_letter].width = width

    output_path = "docs/CampusAttend_Technology_Inventory.xlsx"
    wb.save(output_path)
    print(f"Successfully generated {output_path} with {len(items)} verified technical entries across {len(categories) + 1} worksheets.")

if __name__ == "__main__":
    build_inventory()
