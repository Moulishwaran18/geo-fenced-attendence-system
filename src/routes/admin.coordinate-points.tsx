import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppShell, PageHeader, Section } from "@/components/layout/AppShell";
import { adminNav } from "@/components/layout/nav-config";
import { StatCard } from "@/components/common/StatCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/common/StatusBadge";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CheckCircle,
  MapPin,
  Plus,
  RefreshCcw,
  Save,
  Shield,
  Trash2,
  XCircle,
} from "lucide-react";
import { setActiveGeofencePolygon } from "@/lib/geofence/geofence-service";
import type { LatLng } from "@/lib/geofence/geofence-service";

export const Route = createFileRoute("/admin/coordinate-points")({
  head: () => ({
    meta: [
      { title: "Coordinate Points — CampusAttend Admin" },
      {
        name: "description",
        content:
          "Manage dynamic geofence boundary polygon for campus attendance enforcement.",
      },
    ],
  }),
  component: CoordinatePointsPage,
});

interface Point {
  lat: string;
  lng: string;
}

function pointToLatLng(p: Point): LatLng | null {
  const lat = parseFloat(p.lat);
  const lng = parseFloat(p.lng);
  if (isNaN(lat) || isNaN(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

function isValidPoint(p: Point): boolean {
  return pointToLatLng(p) !== null;
}

function computeCentroid(points: LatLng[]): LatLng {
  const n = points.length;
  return {
    lat: points.reduce((s, p) => s + p.lat, 0) / n,
    lng: points.reduce((s, p) => s + p.lng, 0) / n,
  };
}

function isInsidePolygon(pt: LatLng, polygon: LatLng[]): boolean {
  const x = pt.lng;
  const y = pt.lat;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i]!.lng;
    const yi = polygon[i]!.lat;
    const xj = polygon[j]!.lng;
    const yj = polygon[j]!.lat;
    if (xi === xj && yi === yj) continue;
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

const DEFAULT_POINTS: Point[] = [
  { lat: "11.680008217328185", lng: "78.12153017811703" },
  { lat: "11.68027965716829",  lng: "78.12143270844324" },
  { lat: "11.680658479357865", lng: "78.1219139649576"  },
  { lat: "11.680401954152238", lng: "78.12220332805167" },
  { lat: "11.680020148755307", lng: "78.12218809841514" },
  { lat: "11.67993961161223",  lng: "78.12173730117385" },
];

function CoordinatePointsPage() {
  const [points, setPoints] = useState<Point[]>(DEFAULT_POINTS);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [bulkText, setBulkText] = useState("");
  const [activeTab, setActiveTab] = useState<"table" | "bulk">("table");
  const [testLat, setTestLat] = useState("");
  const [testLng, setTestLng] = useState("");
  const [testResult, setTestResult] = useState<"inside" | "outside" | null>(null);
  const [leafletReady, setLeafletReady] = useState(false);
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const polygonLayerRef = useRef<any>(null);

  // Load current polygon from server on mount
  useEffect(() => {
    fetch("/api/geofence")
      .then((r) => r.json())
      .then((data) => {
        if (data?.success && Array.isArray(data.polygon) && data.polygon.length >= 3) {
          setPoints(
            (data.polygon as LatLng[]).map((p) => ({
              lat: String(p.lat),
              lng: String(p.lng),
            })),
          );
        }
      })
      .catch(() => { /* use defaults */ });
  }, []);

  // Load Leaflet from CDN (same approach as GeofenceMap.tsx)
  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((window as any).L) {
      setLeafletReady(true);
      return;
    }

    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
    link.integrity = "sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=";
    link.crossOrigin = "";
    document.head.appendChild(link);

    const script = document.createElement("script");
    script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
    script.integrity = "sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=";
    script.crossOrigin = "";
    script.onload = () => setLeafletReady(true);
    document.head.appendChild(script);
  }, []);

  // Render map polygon whenever points or leafletReady changes
  useEffect(() => {
    if (!leafletReady || !mapContainerRef.current) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const L = (window as any).L;
    if (!L) return;

    if (!mapRef.current) {
      const map = L.map(mapContainerRef.current, {
        center: [11.6802, 78.1218],
        zoom: 18,
        zoomControl: true,
        attributionControl: false,
      });
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 20,
      }).addTo(map);
      mapRef.current = map;
    }

    // Clear previous polygon and markers (except tile layer)
    if (polygonLayerRef.current) {
      mapRef.current.removeLayer(polygonLayerRef.current);
      polygonLayerRef.current = null;
    }

    const validPts = points.map(pointToLatLng).filter(Boolean) as LatLng[];
    if (validPts.length >= 3) {
      const latlngs = validPts.map((p) => [p.lat, p.lng]);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fg = L.featureGroup() as any;
      L.polygon(latlngs, {
        color: "#2563eb",
        fillColor: "#3b82f6",
        fillOpacity: 0.2,
        weight: 2,
      }).addTo(fg);

      validPts.forEach((p, i) => {
        L.circleMarker([p.lat, p.lng], {
          radius: 7,
          color: "#1d4ed8",
          fillColor: "#3b82f6",
          fillOpacity: 1,
          weight: 2,
        })
          .bindTooltip(`P${i + 1}`, { permanent: false })
          .addTo(fg);
      });

      fg.addTo(mapRef.current);
      mapRef.current.fitBounds(fg.getBounds(), { padding: [20, 20] });
      polygonLayerRef.current = fg;
    }
  }, [leafletReady, points]);

  // Point editor helpers
  const updatePoint = useCallback(
    (index: number, field: "lat" | "lng", value: string) => {
      setPoints((prev) => {
        const copy = [...prev];
        copy[index] = { ...copy[index]!, [field]: value };
        return copy;
      });
    },
    [],
  );

  const addPoint = useCallback(() => {
    setPoints((prev) => [...prev, { lat: "", lng: "" }]);
  }, []);

  const deletePoint = useCallback((index: number) => {
    setPoints((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const moveUp = useCallback((index: number) => {
    if (index === 0) return;
    setPoints((prev) => {
      const copy = [...prev];
      [copy[index - 1], copy[index]] = [copy[index]!, copy[index - 1]!];
      return copy;
    });
  }, []);

  const moveDown = useCallback((index: number) => {
    setPoints((prev) => {
      if (index >= prev.length - 1) return prev;
      const copy = [...prev];
      [copy[index], copy[index + 1]] = [copy[index + 1]!, copy[index]!];
      return copy;
    });
  }, []);

  // Bulk paste parser
  const parseBulkText = useCallback(() => {
    const lines = bulkText
      .trim()
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);

    const parsed: Point[] = [];
    for (const line of lines) {
      const parts = line.split(/[\s,]+/).filter(Boolean);
      if (parts.length >= 2) {
        parsed.push({ lat: parts[0]!, lng: parts[1]! });
      }
    }

    if (parsed.length >= 3) {
      setPoints(parsed);
      setActiveTab("table");
      setBulkText("");
      setErrorMsg("");
    } else {
      setErrorMsg("Could not parse coordinates. Provide at least 3 lines of lat, lng pairs.");
    }
  }, [bulkText]);

  // Save handler
  const handleSave = useCallback(async () => {
    const validPoints = points.map(pointToLatLng).filter(Boolean) as LatLng[];
    if (validPoints.length < 3) {
      setErrorMsg("At least 3 valid coordinate points are required.");
      return;
    }

    setStatus("saving");
    setErrorMsg("");

    try {
      const token =
        (typeof sessionStorage !== "undefined" && sessionStorage.getItem("admin_token")) ||
        (typeof localStorage !== "undefined" && localStorage.getItem("admin_token")) ||
        "";
      const res = await fetch("/api/geofence", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ action: "geofence", points: validPoints }),
      });

      const data = await res.json() as { success: boolean; message?: string; error?: string };
      if (data.success) {
        setStatus("saved");
        setActiveGeofencePolygon(validPoints);
        setTimeout(() => setStatus("idle"), 3000);
      } else {
        setStatus("error");
        setErrorMsg(data.message || data.error || "Failed to save coordinates.");
      }
    } catch (err: unknown) {
      setStatus("error");
      setErrorMsg(err instanceof Error ? err.message : "Network error. Please try again.");
    }
  }, [points]);

  // Test coordinate
  const handleTest = useCallback(() => {
    const lat = parseFloat(testLat);
    const lng = parseFloat(testLng);
    if (isNaN(lat) || isNaN(lng)) {
      setTestResult(null);
      return;
    }
    const validPts = points.map(pointToLatLng).filter(Boolean) as LatLng[];
    if (validPts.length < 3) {
      setTestResult(null);
      return;
    }
    setTestResult(isInsidePolygon({ lat, lng }, validPts) ? "inside" : "outside");
  }, [testLat, testLng, points]);

  const refreshFromServer = useCallback(() => {
    fetch("/api/geofence")
      .then((r) => r.json())
      .then((data: { success?: boolean; polygon?: LatLng[] }) => {
        if (data?.success && Array.isArray(data.polygon) && data.polygon.length >= 3) {
          setPoints(
            data.polygon.map((p) => ({
              lat: String(p.lat),
              lng: String(p.lng),
            })),
          );
        }
      })
      .catch(() => {});
  }, []);

  const validPoints = points.map(pointToLatLng).filter(Boolean) as LatLng[];
  const centroid = validPoints.length >= 3 ? computeCentroid(validPoints) : null;
  const allValid = points.length >= 3 && points.every(isValidPoint);

  return (
    <AppShell nav={adminNav} role="admin">
      <PageHeader
        title="Coordinate Points"
        description="Manage the campus geofence boundary. Staff can only mark attendance inside this polygon."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={refreshFromServer}>
              <RefreshCcw className="mr-2 size-4" /> Refresh
            </Button>
            <Button
              onClick={() => void handleSave()}
              disabled={!allValid || status === "saving"}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {status === "saving" ? (
                <RefreshCcw className="mr-2 size-4 animate-spin" />
              ) : (
                <Save className="mr-2 size-4" />
              )}
              {status === "saving" ? "Saving…" : "Save Changes"}
            </Button>
          </div>
        }
      />

      {/* Stat cards */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Total Vertices"
          value={validPoints.length}
          icon={MapPin}
          tone={allValid ? "success" : "danger"}
          hint={allValid ? "Valid polygon" : "Need ≥ 3 valid points"}
        />
        <StatCard
          label="Centroid Latitude"
          value={centroid ? centroid.lat.toFixed(6) : "—"}
          icon={MapPin}
          tone="neutral"
        />
        <StatCard
          label="Centroid Longitude"
          value={centroid ? centroid.lng.toFixed(6) : "—"}
          icon={MapPin}
          tone="neutral"
        />
        <StatCard
          label="Enforcement"
          value="Strict"
          icon={Shield}
          tone="primary"
          hint="Active on server"
        />
      </div>

      {/* Status messages */}
      {status === "saved" && (
        <div className="mt-4 flex items-center gap-2 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          <CheckCircle className="size-4 shrink-0" />
          Geofence polygon saved and enforced successfully.
        </div>
      )}
      {status === "error" && errorMsg && (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          {errorMsg}
        </div>
      )}
      {!allValid && points.length > 0 && status !== "error" && (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          Some points have invalid coordinates. Fix them before saving.
        </div>
      )}

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        {/* Left: Editor */}
        <div className="xl:col-span-2 space-y-6">
          <Section title="Boundary Polygon Points">
            {/* Tab switcher */}
            <div className="flex border-b border-border px-5">
              {(["table", "bulk"] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`px-4 py-2 text-sm font-medium transition-colors ${
                    activeTab === tab
                      ? "border-b-2 border-primary text-primary"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {tab === "table" ? "Point Editor" : "Bulk Paste"}
                </button>
              ))}
            </div>

            {activeTab === "table" && (
              <div className="p-4">
                <div className="mb-2 grid grid-cols-[2rem_1fr_1fr_6rem] gap-2 px-1 text-xs font-medium text-muted-foreground">
                  <span>#</span>
                  <span>Latitude</span>
                  <span>Longitude</span>
                  <span>Actions</span>
                </div>
                <div className="space-y-2">
                  {points.map((pt, i) => {
                    const valid = isValidPoint(pt);
                    return (
                      <div
                        key={i}
                        className={`grid grid-cols-[2rem_1fr_1fr_6rem] items-center gap-2 rounded-lg border px-2 py-1.5 ${
                          valid ? "border-border" : "border-red-300 bg-red-50"
                        }`}
                      >
                        <span className="text-xs font-mono text-muted-foreground">P{i + 1}</span>
                        <Input
                          className="h-8 font-mono text-xs"
                          placeholder="11.6800…"
                          value={pt.lat}
                          onChange={(e) => updatePoint(i, "lat", e.target.value)}
                        />
                        <Input
                          className="h-8 font-mono text-xs"
                          placeholder="78.1215…"
                          value={pt.lng}
                          onChange={(e) => updatePoint(i, "lng", e.target.value)}
                        />
                        <div className="flex items-center gap-0.5">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-7"
                            onClick={() => moveUp(i)}
                            disabled={i === 0}
                            title="Move up"
                          >
                            <ArrowUp className="size-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-7"
                            onClick={() => moveDown(i)}
                            disabled={i === points.length - 1}
                            title="Move down"
                          >
                            <ArrowDown className="size-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-7 text-destructive hover:bg-destructive/10"
                            onClick={() => deletePoint(i)}
                            disabled={points.length <= 3}
                            title="Delete point"
                          >
                            <Trash2 className="size-3" />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <Button variant="outline" size="sm" className="mt-3" onClick={addPoint}>
                  <Plus className="mr-1.5 size-3.5" /> Add Point
                </Button>
              </div>
            )}

            {activeTab === "bulk" && (
              <div className="space-y-3 p-4">
                <p className="text-sm text-muted-foreground">
                  Paste coordinates one per line as{" "}
                  <code className="rounded bg-muted px-1 py-0.5 text-xs">lat, lng</code>. At
                  least 3 points required.
                </p>
                <Textarea
                  className="h-48 font-mono text-xs"
                  placeholder={"11.680008, 78.121530\n11.680279, 78.121432\n11.680658, 78.121913\n..."}
                  value={bulkText}
                  onChange={(e) => setBulkText(e.target.value)}
                />
                <Button onClick={parseBulkText} disabled={!bulkText.trim()}>
                  Parse & Apply
                </Button>
                {errorMsg && activeTab === "bulk" && (
                  <p className="text-sm text-destructive">{errorMsg}</p>
                )}
              </div>
            )}
          </Section>

          {/* Test coordinate tool */}
          <Section
            title="Test a Coordinate"
            description="Check if a lat/lng falls inside the current polygon."
          >
            <div className="flex flex-wrap items-end gap-3 p-4">
              <div className="flex-1 min-w-[120px]">
                <label className="mb-1 block text-xs font-medium text-muted-foreground">
                  Test Latitude
                </label>
                <Input
                  className="font-mono text-sm"
                  placeholder="11.6800…"
                  value={testLat}
                  onChange={(e) => setTestLat(e.target.value)}
                />
              </div>
              <div className="flex-1 min-w-[120px]">
                <label className="mb-1 block text-xs font-medium text-muted-foreground">
                  Test Longitude
                </label>
                <Input
                  className="font-mono text-sm"
                  placeholder="78.1215…"
                  value={testLng}
                  onChange={(e) => setTestLng(e.target.value)}
                />
              </div>
              <Button variant="outline" onClick={handleTest}>
                Check
              </Button>
              {testResult && (
                <div
                  className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium ${
                    testResult === "inside"
                      ? "bg-green-100 text-green-800"
                      : "bg-red-100 text-red-800"
                  }`}
                >
                  {testResult === "inside" ? (
                    <CheckCircle className="size-4" />
                  ) : (
                    <XCircle className="size-4" />
                  )}
                  {testResult === "inside" ? "Inside polygon" : "Outside polygon"}
                </div>
              )}
            </div>
          </Section>
        </div>

        {/* Right: Map + summary */}
        <div className="space-y-6">
          <Section title="Live Map Preview">
            <div className="p-4">
              <div
                ref={mapContainerRef}
                className="h-64 w-full overflow-hidden rounded-lg border border-border"
                style={{ minHeight: 256 }}
              />
              {!leafletReady && (
                <p className="mt-2 text-xs text-muted-foreground animate-pulse">
                  Loading map…
                </p>
              )}
              {leafletReady && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Blue polygon = current boundary. Updates as you edit.
                </p>
              )}
            </div>
          </Section>

          <Section title="Polygon Summary">
            <ul className="divide-y divide-border text-sm">
              <li className="flex items-center justify-between px-5 py-3">
                <span className="text-muted-foreground">Status</span>
                <StatusBadge status={allValid ? "Active" : "Invalid"} tone={allValid ? undefined : "danger"} />
              </li>
              <li className="flex items-center justify-between px-5 py-3">
                <span className="text-muted-foreground">Vertices</span>
                <span className="font-mono font-medium">{validPoints.length}</span>
              </li>
              {centroid && (
                <>
                  <li className="flex items-center justify-between px-5 py-3">
                    <span className="text-muted-foreground">Center Lat</span>
                    <span className="font-mono text-xs">{centroid.lat.toFixed(6)}</span>
                  </li>
                  <li className="flex items-center justify-between px-5 py-3">
                    <span className="text-muted-foreground">Center Lng</span>
                    <span className="font-mono text-xs">{centroid.lng.toFixed(6)}</span>
                  </li>
                </>
              )}
              <li className="flex items-center justify-between px-5 py-3">
                <span className="text-muted-foreground">Enforcement</span>
                <StatusBadge status="Strict Boundary" />
              </li>
            </ul>
          </Section>

          <div className="flex items-start gap-3 rounded-xl border border-blue-200 bg-blue-50 p-4 text-blue-800">
            <Shield className="mt-0.5 size-5 shrink-0" aria-hidden />
            <p className="text-sm">
              Changes are enforced server-side immediately after saving. Staff outside this polygon
              will be blocked from marking attendance.
            </p>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
