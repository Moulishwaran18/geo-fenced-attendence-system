import { useEffect, useRef, useState } from "react";
import {
  Crosshair,
  MapPin,
  Maximize2,
  Minus,
  Navigation,
  Plus,
  ShieldCheck,
  ShieldAlert,
  Layers,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { AUTHORIZED_GEOFENCE_POLYGON, getPolygonCentroid, type LatLng } from "@/lib/geofence/geofence-service";
import { type UseGeofenceResult } from "@/hooks/use-geofence";

interface GeofenceMapProps {
  geofence: UseGeofenceResult;
  height?: string;
  className?: string;
}

export function GeofenceMap({
  geofence,
  height = "h-[360px]",
  className = "",
}: GeofenceMapProps) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const [mapType, setMapType] = useState<"standard" | "satellite">("standard");
  const [leafletLoaded, setLeafletLoaded] = useState(false);
  const mapInstanceRef = useRef<any>(null);
  const polygonLayerRef = useRef<any>(null);
  const markerLayerRef = useRef<any>(null);
  const accuracyCircleRef = useRef<any>(null);

  const { coords, isInside, accuracy } = geofence;
  const centroid = getPolygonCentroid(AUTHORIZED_GEOFENCE_POLYGON);

  // Dynamic Leaflet CSS and JS Loader for zero-dependency reliable mapping
  useEffect(() => {
    if (typeof window === "undefined") return;

    if ((window as any).L) {
      setLeafletLoaded(true);
      return;
    }

    // Inject CSS
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
    link.integrity = "sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=";
    link.crossOrigin = "";
    document.head.appendChild(link);

    // Inject Script
    const script = document.createElement("script");
    script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
    script.integrity = "sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=";
    script.crossOrigin = "";
    script.onload = () => setLeafletLoaded(true);
    document.head.appendChild(script);
  }, []);

  // Initialize and update Leaflet Map
  useEffect(() => {
    if (!leafletLoaded || !mapContainerRef.current) return;
    const L = (window as any).L;
    if (!L) return;

    if (!mapInstanceRef.current) {
      const initialLat = coords ? coords.lat : centroid.lat;
      const initialLng = coords ? coords.lng : centroid.lng;

      const map = L.map(mapContainerRef.current, {
        center: [initialLat, initialLng],
        zoom: 18,
        zoomControl: false,
        attributionControl: false,
      });

      // OpenStreetMap Tiles
      const tileUrl =
        mapType === "satellite"
          ? "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
          : "https://{s}.tile.openstreetmap.org/{z}/{x}.png";

      L.tileLayer(tileUrl, {
        maxZoom: 20,
        subdomains: ["a", "b", "c"],
      }).addTo(map);

      mapInstanceRef.current = map;
    }

    const map = mapInstanceRef.current;

    // Draw Polygon
    const polyCoords = AUTHORIZED_GEOFENCE_POLYGON.map((p) => [p.lat, p.lng]);
    const isUserInside = isInside === true;

    if (polygonLayerRef.current) {
      map.removeLayer(polygonLayerRef.current);
    }

    const polygonColor = isUserInside ? "#10b981" : "#ef4444";
    const polygonFill = isUserInside ? "rgba(16, 185, 129, 0.25)" : "rgba(239, 68, 68, 0.20)";

    polygonLayerRef.current = L.polygon(polyCoords, {
      color: polygonColor,
      weight: 3,
      opacity: 0.9,
      fillColor: polygonFill,
      fillOpacity: 0.35,
      dashArray: isUserInside ? undefined : "6, 6",
    }).addTo(map);

    polygonLayerRef.current.bindPopup(
      `<div style="font-family:sans-serif;font-size:12px;padding:4px;">
        <strong style="color:${polygonColor};">Authorized Campus Geofence</strong><br/>
        19 Authoritative Vertices (C1 → C19 → C1)
      </div>`,
    );

    // Draw User Pin & Accuracy Circle if coordinates available
    if (coords) {
      const userLat = coords.lat;
      const userLng = coords.lng;

      if (accuracyCircleRef.current) {
        map.removeLayer(accuracyCircleRef.current);
      }
      if (markerLayerRef.current) {
        map.removeLayer(markerLayerRef.current);
      }

      // Accuracy circle
      if (coords.accuracy) {
        accuracyCircleRef.current = L.circle([userLat, userLng], {
          radius: coords.accuracy,
          color: isUserInside ? "#10b981" : "#3b82f6",
          fillColor: isUserInside ? "#10b981" : "#3b82f6",
          fillOpacity: 0.12,
          weight: 1,
        }).addTo(map);
      }

      // User Marker
      const userIcon = L.divIcon({
        className: "custom-user-marker",
        html: `
          <div style="position:relative;width:24px;height:24px;">
            <div style="position:absolute;inset:0;border-radius:50%;background:${
              isUserInside ? "#10b981" : "#ef4444"
            };opacity:0.4;animation:ping 1.5s cubic-bezier(0,0,0.2,1) infinite;"></div>
            <div style="position:absolute;top:4px;left:4px;width:16px;height:16px;border-radius:50%;background:${
              isUserInside ? "#10b981" : "#ef4444"
            };border:2.5px solid #ffffff;box-shadow:0 2px 6px rgba(0,0,0,0.3);"></div>
          </div>
        `,
        iconSize: [24, 24],
        iconAnchor: [12, 12],
      });

      markerLayerRef.current = L.marker([userLat, userLng], { icon: userIcon }).addTo(map);
      markerLayerRef.current.bindPopup(
        `<div style="font-family:sans-serif;font-size:12px;padding:4px;">
          <strong>Your Current Location</strong><br/>
          Lat: ${userLat.toFixed(6)}<br/>
          Lng: ${userLng.toFixed(6)}<br/>
          Accuracy: ±${Math.round(coords.accuracy || 0)}m<br/>
          Status: <span style="font-weight:bold;color:${isUserInside ? "#10b981" : "#ef4444"};">
            ${isUserInside ? "INSIDE GEOFENCE" : "OUTSIDE GEOFENCE"}
          </span>
        </div>`,
      );
    }
  }, [leafletLoaded, coords, isInside, mapType, centroid.lat, centroid.lng]);

  const handleRecenterUser = () => {
    if (mapInstanceRef.current && coords) {
      mapInstanceRef.current.setView([coords.lat, coords.lng], 19, { animate: true });
    }
  };

  const handleRecenterGeofence = () => {
    if (mapInstanceRef.current && polygonLayerRef.current) {
      mapInstanceRef.current.fitBounds(polygonLayerRef.current.getBounds(), {
        padding: [20, 20],
        animate: true,
      });
    }
  };

  const handleZoomIn = () => {
    if (mapInstanceRef.current) {
      mapInstanceRef.current.zoomIn();
    }
  };

  const handleZoomOut = () => {
    if (mapInstanceRef.current) {
      mapInstanceRef.current.zoomOut();
    }
  };

  return (
    <div className={`relative overflow-hidden rounded-xl border border-border bg-card shadow-sm ${height} ${className}`}>
      {/* Map Target Container */}
      <div ref={mapContainerRef} className="size-full z-0" />

      {/* Fallback Static Canvas / SVG if Leaflet is loading */}
      {!leafletLoaded && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-muted/60 text-muted-foreground p-4">
          <Navigation className="size-8 animate-pulse text-primary mb-2" />
          <p className="text-xs font-medium">Loading high-precision geofence map…</p>
        </div>
      )}

      {/* Floating Geofence Status Badge Overlay */}
      <div className="pointer-events-none absolute top-3 left-3 z-10">
        {isInside === true ? (
          <div className="flex items-center gap-2 rounded-lg border border-success/40 bg-card/95 px-3 py-1.5 shadow-md backdrop-blur">
            <span className="grid size-5 place-items-center rounded-full bg-success text-white">
              <ShieldCheck className="size-3.5" />
            </span>
            <div className="text-left">
              <div className="text-[11px] font-bold text-success leading-tight">
                INSIDE AUTHORIZED GEOFENCE
              </div>
              <div className="text-[10px] text-muted-foreground">Location verified for attendance</div>
            </div>
          </div>
        ) : isInside === false ? (
          <div className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-card/95 px-3 py-1.5 shadow-md backdrop-blur">
            <span className="grid size-5 place-items-center rounded-full bg-destructive text-white">
              <ShieldAlert className="size-3.5" />
            </span>
            <div className="text-left">
              <div className="text-[11px] font-bold text-destructive leading-tight">
                OUTSIDE GEOFENCE
              </div>
              <div className="text-[10px] text-muted-foreground">Attendance marking restricted</div>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 rounded-lg border border-border bg-card/95 px-3 py-1.5 shadow-md backdrop-blur">
            <span className="grid size-5 place-items-center rounded-full bg-primary/20 text-primary">
              <Navigation className="size-3.5 animate-spin" />
            </span>
            <div className="text-left">
              <div className="text-[11px] font-bold text-foreground leading-tight">
                CHECKING GPS LOCATION
              </div>
              <div className="text-[10px] text-muted-foreground">Acquiring coordinate fix…</div>
            </div>
          </div>
        )}
      </div>

      {/* Map Control Buttons */}
      <div className="absolute top-3 right-3 z-10 flex flex-col gap-1.5">
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-8 bg-card/90 shadow-md backdrop-blur"
          onClick={handleRecenterUser}
          title="Center on My Location"
          disabled={!coords}
        >
          <Crosshair className="size-4 text-foreground" />
        </Button>

        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-8 bg-card/90 shadow-md backdrop-blur"
          onClick={handleRecenterGeofence}
          title="Fit Campus Geofence"
        >
          <Maximize2 className="size-4 text-foreground" />
        </Button>

        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-8 bg-card/90 shadow-md backdrop-blur"
          onClick={handleZoomIn}
          title="Zoom In"
        >
          <Plus className="size-4 text-foreground" />
        </Button>

        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-8 bg-card/90 shadow-md backdrop-blur"
          onClick={handleZoomOut}
          title="Zoom Out"
        >
          <Minus className="size-4 text-foreground" />
        </Button>
      </div>

      {/* Legend Footer */}
      <div className="pointer-events-none absolute bottom-3 left-3 z-10 flex flex-wrap gap-2 rounded-lg border border-border bg-card/95 px-3 py-1.5 text-[11px] shadow-md backdrop-blur">
        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
          <span className="size-2 rounded-full bg-success" />
          Inside Geofence
        </span>
        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
          <span className="size-2 rounded-full bg-destructive" />
          Outside Geofence
        </span>
        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
          <span className="size-2 rounded-full bg-primary" />
          Your Location (GPS)
        </span>
      </div>
    </div>
  );
}
