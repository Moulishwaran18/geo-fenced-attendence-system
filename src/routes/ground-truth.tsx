// src/routes/ground-truth.tsx
import { useState, useMemo } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useGeofence } from "@/hooks/use-geofence";
import { Badge } from "@/components/ui/badge";
import { formatIndiaTime } from "@/lib/india-time";

/**
 * Ground Truth Testing Screen (developer only)
 * Allows entering reference latitude/longitude and compares with the current filtered
 * position reported by the native/location hook. Displays the absolute error in meters
 * and the current raw accuracy.
 */
export const Route = createFileRoute("/ground-truth")({
  component: GroundTruthPage,
});

function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number) {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371000; // Earth radius in meters
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) *
    Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function GroundTruthPage() {
  const geofence = useGeofence(true);
  const { filteredCoords, rawAccuracy, status, statusMessage } = geofence;

  const [refLat, setRefLat] = useState<string>("");
  const [refLon, setRefLon] = useState<string>("");
  const [errorMeters, setErrorMeters] = useState<number | null>(null);

  const handleCalculate = () => {
    const lat = parseFloat(refLat);
    const lon = parseFloat(refLon);
    if (isNaN(lat) || isNaN(lon) || !filteredCoords) {
      setErrorMeters(null);
      return;
    }
    const distance = haversineDistance(lat, lon, filteredCoords.latitude, filteredCoords.longitude);
    setErrorMeters(distance);
  };

  const resultBadge = useMemo(() => {
    if (errorMeters === null) return null;
    const label = `${errorMeters.toFixed(2)} m error`;
    const color =
      errorMeters <= 10
        ? "bg-emerald-500/15 text-emerald-600"
        : errorMeters <= 20
        ? "bg-blue-500/15 text-blue-600"
        : "bg-amber-500/15 text-amber-600";
    return <Badge className={color}>{label}</Badge>;
  }, [errorMeters]);

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-6">
      <h1 className="text-3xl font-bold">Ground Truth Testing</h1>
      <p className="text-muted-foreground">
        Enter reference coordinates (e.g., from a survey‑grade GPS) and compare them with the
        filtered location reported by the app.
      </p>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Input placeholder="Reference Latitude" value={refLat} onChange={(e) => setRefLat(e.target.value)} />
        <Input placeholder="Reference Longitude" value={refLon} onChange={(e) => setRefLon(e.target.value)} />
      </div>
      <Button onClick={handleCalculate}>Calculate Error</Button>
      {resultBadge && <div>{resultBadge}</div>}
      <div className="border-t pt-4">
        <h2 className="text-xl font-semibold">Current Position Info</h2>
        <p>Status: {status}</p>
        <p>Status Message: {statusMessage}</p>
        {filteredCoords && (
          <p>
            Filtered Coords: {filteredCoords.latitude.toFixed(6)}, {filteredCoords.longitude.toFixed(6)}
          </p>
        )}
        <p>Raw Accuracy: {rawAccuracy ? `${Math.round(rawAccuracy)} m` : "—"}</p>
        <p>Last Update: {formatIndiaTime(new Date())}</p>
        <Link to="/mark-attendance" className="text-primary underline">
          Back to Attendance
        </Link>
      </div>
    </div>
  );
}
