import { useEffect, useState, useCallback, useRef } from "react";
import {
  AUTHORIZED_GEOFENCE_POLYGON,
  evaluateGeofence,
  type GeofenceEvaluation,
  type LatLng,
} from "@/lib/geofence/geofence-service";

export type GpsStatus =
  | "idle"
  | "acquiring"
  | "inside"
  | "outside"
  | "permission_denied"
  | "position_unavailable"
  | "timeout"
  | "low_accuracy"
  | "unsupported";

export interface GpsCoordinates {
  lat: number;
  lng: number;
  accuracy: number;
  altitude?: number | null | undefined;
  altitudeAccuracy?: number | null | undefined;
  heading?: number | null | undefined;
  speed?: number | null | undefined;
  timestamp: number;
}

export interface UseGeofenceResult {
  coords: GpsCoordinates | null;
  evaluation: GeofenceEvaluation | null;
  isInside: boolean | null;
  status: GpsStatus;
  statusMessage: string;
  isChecking: boolean;
  accuracy: number | null;
  distanceToBoundary: number | null;
  distanceToCentroid: number | null;
  lastUpdated: Date | null;
  error: string | null;
  checkLocation: (fresh?: boolean) => Promise<GeofenceEvaluation | null>;
  polygon: LatLng[];
}

export function useGeofence(
  autoWatch: boolean = true,
  accuracyThresholdMeters: number = 65,
): UseGeofenceResult {
  const [coords, setCoords] = useState<GpsCoordinates | null>(null);
  const [evaluation, setEvaluation] = useState<GeofenceEvaluation | null>(null);
  const [status, setStatus] = useState<GpsStatus>("idle");
  const [statusMessage, setStatusMessage] = useState<string>("Initializing GPS…");
  const [isChecking, setIsChecking] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const watchIdRef = useRef<number | null>(null);

  const processPosition = useCallback(
    (pos: GeolocationPosition): GeofenceEvaluation => {
      const { latitude, longitude, accuracy, altitude, altitudeAccuracy, heading, speed } =
        pos.coords;

      const newCoords: GpsCoordinates = {
        lat: latitude,
        lng: longitude,
        accuracy,
        altitude,
        altitudeAccuracy,
        heading,
        speed,
        timestamp: pos.timestamp,
      };

      const evalResult = evaluateGeofence(
        { lat: latitude, lng: longitude, accuracy },
        AUTHORIZED_GEOFENCE_POLYGON,
      );

      setCoords(newCoords);
      setEvaluation(evalResult);
      setLastUpdated(new Date(pos.timestamp));
      setError(null);

      if (accuracy > accuracyThresholdMeters) {
        setStatus("low_accuracy");
        setStatusMessage(`Low GPS Accuracy (±${Math.round(accuracy)}m). Move to an open area.`);
      } else if (evalResult.isInside) {
        setStatus("inside");
        setStatusMessage(
          `Inside Authorized Region (±${Math.round(accuracy)}m accuracy · ${evalResult.distanceToBoundaryMeters}m from boundary)`,
        );
      } else {
        setStatus("outside");
        setStatusMessage(
          `Outside Authorized Region (${evalResult.distanceToBoundaryMeters}m from perimeter)`,
        );
      }

      return evalResult;
    },
    [accuracyThresholdMeters],
  );

  const processError = useCallback((err: GeolocationPositionError) => {
    let newStatus: GpsStatus = "position_unavailable";
    let message = "Unable to determine location.";

    switch (err.code) {
      case err.PERMISSION_DENIED:
        newStatus = "permission_denied";
        message = "GPS permission denied. Please allow location access in browser settings.";
        break;
      case err.POSITION_UNAVAILABLE:
        newStatus = "position_unavailable";
        message = "GPS position unavailable. Ensure device location is turned on.";
        break;
      case err.TIMEOUT:
        newStatus = "timeout";
        message = "GPS request timed out. Retrying location…";
        break;
    }

    setStatus(newStatus);
    setStatusMessage(message);
    setError(message);
  }, []);

  const checkLocation = useCallback(
    async (fresh: boolean = true): Promise<GeofenceEvaluation | null> => {
      if (typeof window === "undefined" || !navigator.geolocation) {
        setStatus("unsupported");
        setStatusMessage("Geolocation is not supported by this browser.");
        setError("Geolocation unsupported");
        return null;
      }

      setIsChecking(true);
      setStatus("acquiring");
      setStatusMessage("Acquiring fresh high-accuracy GPS fix…");

      return new Promise<GeofenceEvaluation | null>((resolve) => {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            setIsChecking(false);
            const evalResult = processPosition(pos);
            resolve(evalResult);
          },
          (err) => {
            setIsChecking(false);
            processError(err);
            resolve(null);
          },
          {
            enableHighAccuracy: true,
            timeout: 15000,
            maximumAge: fresh ? 0 : 5000,
          },
        );
      });
    },
    [processPosition, processError],
  );

  useEffect(() => {
    if (typeof window === "undefined" || !navigator.geolocation) {
      setStatus("unsupported");
      setStatusMessage("Geolocation is not supported by this browser.");
      return;
    }

    // Initial check
    void checkLocation(false);

    if (autoWatch) {
      try {
        watchIdRef.current = navigator.geolocation.watchPosition(
          (pos) => {
            processPosition(pos);
          },
          (err) => {
            processError(err);
          },
          {
            enableHighAccuracy: true,
            timeout: 20000,
            maximumAge: 3000,
          },
        );
      } catch (e) {
        console.warn("watchPosition notice:", e);
      }
    }

    return () => {
      if (watchIdRef.current !== null && typeof window !== "undefined" && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
    };
  }, [autoWatch, checkLocation, processPosition, processError]);

  return {
    coords,
    evaluation,
    isInside: evaluation ? evaluation.isInside : null,
    status,
    statusMessage,
    isChecking,
    accuracy: coords ? coords.accuracy : null,
    distanceToBoundary: evaluation ? evaluation.distanceToBoundaryMeters : null,
    distanceToCentroid: evaluation ? evaluation.distanceToCentroidMeters : null,
    lastUpdated,
    error,
    checkLocation,
    polygon: AUTHORIZED_GEOFENCE_POLYGON,
  };
}
