// src/components/common/LiveGpsPanel.tsx
import React, { useMemo } from "react";
import { useGeofence } from "@/hooks/use-geofence";
import { LineChart, Line, XAxis, YAxis, Tooltip, Legend, CartesianGrid, ResponsiveContainer } from "recharts";
import { Badge } from "@/components/ui/badge";
import { formatIndiaTime } from "@/lib/india-time";

/**
 * Live GPS accuracy display.
 * Shows a table of each sample and a live accuracy graph.
 * Consumes the useGeofence hook which provides the full reading history.
 */
export function LiveGpsPanel() {
  const {
    readingsHistory,
    maxAcquisitionSeconds,
    readingsCollected,
    bestAccuracy,
    kalmanEstimatedAccuracy,
    rawCoords,
    filteredCoords,
    positionStability,
    kalmanStatus,
  } = useGeofence(true);

  // Build chart data – use raw accuracy per sample and the latest filtered accuracy.
  const chartData = useMemo(() => {
    return readingsHistory.map((r) => ({
      sample: r.sampleIndex,
      rawAccuracy: Number(r.accuracy.toFixed(1)),
    }));
  }, [readingsHistory]);

  // Compute RMS deviation from displacementFromPrev values (if present).
  const rmsDeviation = useMemo(() => {
    const values = readingsHistory
      .map((r) => r.displacementFromPrev)
      .filter((v): v is number => typeof v === "number");
    if (values.length === 0) return null;
    const sumSq = values.reduce((sum, v) => sum + v * v, 0);
    return Math.sqrt(sumSq / values.length);
  }, [readingsHistory]);

  const latestSample = readingsHistory[readingsHistory.length - 1];

  // Determine acquisition status text.
  const acquisitionStatus = useMemo(() => {
    if (!latestSample) return "Acquiring GPS...";
    const acc = latestSample.accuracy;
    if (acc <= 15 && positionStability === "STABLE") return "GPS ACCURACY EXCELLENT (≤15m)";
    if (acc <= 20) return "GPS ACCURACY ACCEPTED (≤20m)";
    return "GPS ACCURACY INSUFFICIENT (>20m) — Acquiring a better GPS fix...";
  }, [latestSample, positionStability]);

  return (
    <div className="space-y-6 rounded-lg border p-4 bg-muted/20">
      <h2 className="text-xl font-semibold">GPS Acquisition</h2>
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm font-mono bg-muted/40 p-2 rounded border border-border">
        <div>GPS readings collected: <span className="font-bold">{readingsCollected}</span></div>
        <div>Best accuracy: <span className="font-bold">{bestAccuracy !== null ? `±${bestAccuracy.toFixed(1)}m` : "—"}</span></div>
        <div>Target accuracy: <span className="font-bold text-emerald-600 dark:text-emerald-400">&lt;=15m</span></div>
      </div>
      <div className="text-sm text-muted-foreground">
        {acquisitionStatus} (Sample {readingsCollected} / {maxAcquisitionSeconds}s)
      </div>

      {/* Table of latest sample */}
      {latestSample && (
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div>Timestamp:</div>
          <div>{formatIndiaTime(new Date(latestSample.timestamp))}</div>
          <div>Raw Latitude:</div>
          <div>{latestSample.lat.toFixed(6)}</div>
          <div>Raw Longitude:</div>
          <div>{latestSample.lng.toFixed(6)}</div>
          <div>Raw Accuracy:</div>
          <div>±{latestSample.accuracy.toFixed(1)} m</div>
          <div>Filtered Latitude:</div>
          <div>{latestSample.filteredLat.toFixed(6)}</div>
          <div>Filtered Longitude:</div>
          <div>{latestSample.filteredLng.toFixed(6)}</div>
          <div>Filtered Accuracy:</div>
          <div>±{(kalmanEstimatedAccuracy ?? latestSample.accuracy).toFixed(1)} m</div>
          <div>Position Stability:</div>
          <div>{positionStability}</div>
          <div>RMS Deviation:</div>
          <div>{rmsDeviation !== null ? `${rmsDeviation.toFixed(2)} m` : "—"}</div>
        </div>
      )}

      {/* Live accuracy graph */}
      <div className="h-64 w-full">
        <ResponsiveContainer>
          <LineChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="sample" label={{ value: "Sample", position: "insideBottomRight", offset: -5 }} />
            <YAxis label={{ value: "Accuracy (m)", angle: -90, position: "insideLeft" }} />
            <Tooltip />
            <Legend verticalAlign="top" height={36} />
            <Line type="monotone" dataKey="rawAccuracy" stroke="#ef4444" name="Raw Accuracy" dot={false} />
            {/* Filtered accuracy is only known for the latest reading; we plot it as a step line */}
            <Line
              type="stepAfter"
              dataKey={() => (kalmanEstimatedAccuracy ?? null)}
              stroke="#22c55e"
              name="Filtered Accuracy"
              dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
