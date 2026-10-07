import { useEffect, useState, useCallback, useRef } from "react";
import {
  AUTHORIZED_GEOFENCE_POLYGON,
  evaluateGeofence,
  haversineDistanceMeters,
  type GeofenceEvaluation,
  type LatLng,
} from "../lib/geofence/geofence-service.ts";
import {
  GpsKalmanFilter,
  type KalmanFilteredPosition,
} from "../lib/geofence/kalman-filter.ts";

export type GpsStatus =
  | "idle"
  | "acquiring"
  | "inside"
  | "outside"
  | "insufficient_accuracy"
  | "low_accuracy"
  | "permission_denied"
  | "position_unavailable"
  | "timeout"
  | "unsupported";

export type GpsQuality = "EXCELLENT" | "GOOD" | "ACQUIRING / WAIT" | "UNRELIABLE" | "UNKNOWN";
export type PositionStability = "STABLE" | "UNSTABLE" | "MEASURING";
export type KalmanStatus = "INITIALIZING" | "ACTIVE" | "SETTLED" | "OFF";

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

export interface GpsReading extends GpsCoordinates {
  filteredLat: number;
  filteredLng: number;
  filteredEastMeters: number;
  filteredNorthMeters: number;
  quality: GpsQuality;
  displacementFromPrev?: number | undefined;
  sampleIndex: number;
  kalmanStatus: KalmanStatus;
  rmsPositionDeviation?: number | null | undefined;
}

export interface StabilityEvaluation {
  isStable: boolean;
  consecutiveGoodCount: number;
  maxDisplacementMeters: number;
  status: PositionStability;
}

export interface UseGeofenceResult {
  locationSource: "NATIVE FUSED" | "BROWSER";
  coords: GpsCoordinates | null;
  currentCoords: GpsCoordinates | null;
  rawCoords: GpsCoordinates | null;
  filteredCoords: GpsCoordinates | null;
  bestCoords: GpsCoordinates | null;
  evaluation: GeofenceEvaluation | null;
  isInside: boolean | null;
  isInsidePolygon: boolean | null;
  isAcceptableAccuracy: boolean;
  isTargetAccuracy?: boolean;
  status: GpsStatus;
  statusMessage: string;
  instructionMessage: string | null;
  isChecking: boolean;
  accuracy: number | null;
  rawAccuracy: number | null;
  bestAccuracy: number | null;
  kalmanStatus: KalmanStatus;
  kalmanEstimatedAccuracy: number | null;
  gpsQuality: GpsQuality;
  positionStability: PositionStability;
  readingsCollected: number;
  readingsHistory: GpsReading[];
  acquisitionTimer: number;
  maxAcquisitionSeconds: number;
  isStable: boolean;
  consecutiveGoodCount: number;
  distanceToBoundary: number | null;
  distanceToCentroid: number | null;
  lastUpdated: Date | null;
  error: string | null;
  refreshLocation: () => Promise<GeofenceEvaluation | null>;
  checkLocation: (fresh?: boolean) => Promise<GeofenceEvaluation | null>;
  openLocationSettings?: () => void;
  rmsPositionDeviation: number | null;
  polygon: LatLng[];
}

/**
 * GPS Accuracy Constants:
 * 1. GPS ACCEPTANCE THRESHOLD = 20 meters:
 *    Hard acceptance threshold. If accuracy <= 20m, geofence verification is allowed to proceed.
 * 2. GPS TARGET/BEST-ACCURACY GOAL = 15 meters:
 *    Preferred accuracy target. NOT a hard gate.
 */
export const GPS_ACCEPTANCE_THRESHOLD_METERS = 20;
export const GPS_TARGET_ACCURACY_METERS = 15;

export interface GpsAccuracyTierInfo {
  isAccepted: boolean;
  isTargetReached: boolean;
  tier: "EXCELLENT" | "ACCEPTED" | "INSUFFICIENT" | "UNKNOWN";
  statusText: string;
  instructionText: string | null;
}

/**
 * Evaluates GPS reading accuracy against the 20m acceptance threshold
 * and 15m best-accuracy target goal:
 * - accuracy > 20m: NOT ACCEPTED ("GPS accuracy insufficient — Current accuracy: ±...m", "Acquiring better GPS fix...")
 * - accuracy <= 20m and > 15m: ACCEPTED ("GPS accuracy accepted — Current accuracy: ±...m", "Improving GPS accuracy toward ±15m...")
 * - accuracy <= 15m: EXCELLENT / PREFERRED ("GPS accuracy excellent — Current accuracy: ±...m", instruction: null)
 */
export function evaluateGpsAccuracy(accuracy: number | null | undefined): GpsAccuracyTierInfo {
  if (accuracy === null || accuracy === undefined || isNaN(accuracy)) {
    return {
      isAccepted: false,
      isTargetReached: false,
      tier: "UNKNOWN",
      statusText: "Waiting for accurate GPS location...",
      instructionText: "Move to open sky if possible.",
    };
  }

  const accStr = accuracy.toFixed(1);

  if (accuracy <= GPS_TARGET_ACCURACY_METERS) {
    return {
      isAccepted: true,
      isTargetReached: true,
      tier: "EXCELLENT",
      statusText: `GPS accuracy excellent — Current accuracy: ±${accStr}m`,
      instructionText: null,
    };
  }

  if (accuracy <= GPS_ACCEPTANCE_THRESHOLD_METERS) {
    return {
      isAccepted: true,
      isTargetReached: false,
      tier: "ACCEPTED",
      statusText: `GPS accuracy accepted — Current accuracy: ±${accStr}m`,
      instructionText: "Improving GPS accuracy toward ±15m...",
    };
  }

  return {
    isAccepted: false,
    isTargetReached: false,
    tier: "INSUFFICIENT",
    statusText: `GPS accuracy insufficient — Current accuracy: ±${accStr}m`,
    instructionText: "Acquiring better GPS fix...",
  };
}

/**
 * Determines GPS Quality tier based on exact reported raw accuracy:
 * accuracy <= 15 m: EXCELLENT (Preferred target goal reached)
 * accuracy > 15 m && <= 20 m: GOOD (Accepted fix, improving toward 15m)
 * accuracy > 20 m && <= 50 m: ACQUIRING / WAIT (Insufficient accuracy)
 * accuracy > 50 m: UNRELIABLE
 */
export function getGpsQuality(accuracy: number | null | undefined): GpsQuality {
  if (accuracy === null || accuracy === undefined || isNaN(accuracy)) {
    return "UNKNOWN";
  }
  if (accuracy <= GPS_TARGET_ACCURACY_METERS) return "EXCELLENT";
  if (accuracy <= GPS_ACCEPTANCE_THRESHOLD_METERS) return "GOOD";
  if (accuracy <= 50) return "ACQUIRING / WAIT";
  return "UNRELIABLE";
}

/**
 * Checks temporal stability across consecutive filtered readings.
 * Requires at least 2 consecutive good readings (raw accuracy <= 20m) where displacement <= 15m.
 */
export function checkTemporalStability(
  readings: GpsReading[],
  maxJumpMeters: number = 15,
): StabilityEvaluation {
  if (readings.length < 2) {
    const singleGood = readings.filter((r) => r.accuracy <= 20).length;
    return {
      isStable: false,
      consecutiveGoodCount: singleGood,
      maxDisplacementMeters: 0,
      status: "MEASURING",
    };
  }

  // Count consecutive good readings at the tail of history
  let consecutiveGood = 0;
  for (let i = readings.length - 1; i >= 0; i--) {
    if (readings[i]!.accuracy <= 20) {
      consecutiveGood++;
    } else {
      break;
    }
  }

  if (consecutiveGood < 2) {
    return {
      isStable: false,
      consecutiveGoodCount: consecutiveGood,
      maxDisplacementMeters: 0,
      status: "MEASURING",
    };
  }

  // Check displacement between the consecutive filtered positions
  const goodSamples = readings.slice(-consecutiveGood);
  let maxDisp = 0;
  for (let i = 1; i < goodSamples.length; i++) {
    const prev = goodSamples[i - 1]!;
    const curr = goodSamples[i]!;
    const prevLat = prev.filteredLat ?? prev.lat;
    const prevLng = prev.filteredLng ?? prev.lng;
    const currLat = curr.filteredLat ?? curr.lat;
    const currLng = curr.filteredLng ?? curr.lng;
    const disp = haversineDistanceMeters(
      { lat: prevLat, lng: prevLng },
      { lat: currLat, lng: currLng },
    );
    if (disp > maxDisp) {
      maxDisp = disp;
    }
  }

  const isStable = consecutiveGood >= 2 && maxDisp <= maxJumpMeters;
  return {
    isStable,
    consecutiveGoodCount: consecutiveGood,
    maxDisplacementMeters: parseFloat(maxDisp.toFixed(2)),
    status: isStable ? "STABLE" : "UNSTABLE",
  };
}

const DEFAULT_MAX_ACQUISITION_SECONDS = 15;

export function useGeofence(
  autoWatch: boolean = true,
  maxAcquisitionSeconds: number = DEFAULT_MAX_ACQUISITION_SECONDS,
): UseGeofenceResult {
  const [coords, setCoords] = useState<GpsCoordinates | null>(null);
  const [rawCoords, setRawCoords] = useState<GpsCoordinates | null>(null);
  const [filteredCoords, setFilteredCoords] = useState<GpsCoordinates | null>(null);
  const [bestCoords, setBestCoords] = useState<GpsCoordinates | null>(null);
  const [evaluation, setEvaluation] = useState<GeofenceEvaluation | null>(null);
  const [status, setStatus] = useState<GpsStatus>("idle");
  const [statusMessage, setStatusMessage] = useState<string>("Waiting for accurate GPS location...");
  const [instructionMessage, setInstructionMessage] = useState<string | null>("Move to open sky if possible.");
  const [isChecking, setIsChecking] = useState<boolean>(false);
  const [readingsCollected, setReadingsCollected] = useState<number>(0);
  const [readingsHistory, setReadingsHistory] = useState<GpsReading[]>([]);
  const [bestAccuracy, setBestAccuracy] = useState<number | null>(null);
  const [kalmanStatus, setKalmanStatus] = useState<KalmanStatus>("OFF");
  const [kalmanEstimatedAccuracy, setKalmanEstimatedAccuracy] = useState<number | null>(null);
  const [acquisitionTimer, setAcquisitionTimer] = useState<number>(0);
  const [isStable, setIsStable] = useState<boolean>(false);
  const [consecutiveGoodCount, setConsecutiveGoodCount] = useState<number>(0);
  const [positionStability, setPositionStability] = useState<PositionStability>("MEASURING");
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const watchIdRef = useRef<number | null>(null);
  const timerIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const readingsRef = useRef<GpsReading[]>([]);
  const bestReadingRef = useRef<GpsReading | null>(null);
  const isAcquiringRef = useRef<boolean>(false);
  const kalmanRef = useRef<GpsKalmanFilter>(new GpsKalmanFilter());

  const isNativeAndroid =
    typeof window !== "undefined" &&
    (Boolean((window as any).AndroidLocationBridge) || Boolean((window as any).NativeLocation));
  const locationSource: "NATIVE FUSED" | "BROWSER" = isNativeAndroid ? "NATIVE FUSED" : "BROWSER";

  const stopActiveAcquisition = useCallback(() => {
    if (watchIdRef.current !== null && typeof window !== "undefined" && navigator.geolocation) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    if (typeof window !== "undefined" && (window as any).AndroidLocationBridge?.stopLocationUpdates) {
      try {
        (window as any).AndroidLocationBridge.stopLocationUpdates();
      } catch (e) {
        console.warn("Native bridge stop error:", e);
      }
    }
    if (timerIntervalRef.current !== null) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
    isAcquiringRef.current = false;
    setIsChecking(false);
  }, []);

  const evaluateAndFinalize = useCallback(
    (reading: GpsReading, stability: StabilityEvaluation) => {
      // Evaluate against authoritative campus polygon using the Kalman-filtered position
      const evalResult = evaluateGeofence(
        { lat: reading.filteredLat, lng: reading.filteredLng, accuracy: reading.accuracy },
        AUTHORIZED_GEOFENCE_POLYGON,
      );

      setCoords(reading);
      setEvaluation(evalResult);
      setLastUpdated(new Date(reading.timestamp));
      setError(null);
      setIsStable(stability.isStable);
      setConsecutiveGoodCount(stability.consecutiveGoodCount);
      setPositionStability(stability.status);

      // Deterministic Decision: Accuracy <= 20m + Point in Polygon
      const accInfo = evaluateGpsAccuracy(reading.accuracy);
      if (accInfo.isAccepted) {
        if (evalResult.isInside) {
          setStatus("inside");
          setStatusMessage(accInfo.statusText);
          setInstructionMessage(accInfo.instructionText);
        } else {
          setStatus("outside");
          setStatusMessage(`Outside Authorized Region (${evalResult.distanceToBoundaryMeters}m from perimeter · ±${reading.accuracy.toFixed(1)}m raw accuracy)`);
          setInstructionMessage(null);
        }
      } else {
        setStatus("insufficient_accuracy");
        setStatusMessage(accInfo.statusText);
        setInstructionMessage(accInfo.instructionText);
      }

      return evalResult;
    },
    [],
  );

  const handlePositionReading = useCallback(
    (pos: {
      coords: {
        latitude: number;
        longitude: number;
        accuracy: number;
        altitude?: number | null | undefined;
        altitudeAccuracy?: number | null | undefined;
        heading?: number | null | undefined;
        speed?: number | null | undefined;
      };
      timestamp: number;
      rmsPositionDeviation?: number | null | undefined;
    }) => {
      const { latitude, longitude, accuracy, altitude, altitudeAccuracy, heading, speed } = pos.coords;
      const rawQuality = getGpsQuality(accuracy);

      // Run 2D Constant-Velocity Kalman Filter on local metric coordinates
      const kalmanResult = kalmanRef.current.update({
        lat: latitude,
        lng: longitude,
        accuracy,
        timestamp: pos.timestamp,
      });

      const history = readingsRef.current;
      let displacementFromPrev: number | undefined = undefined;
      if (history.length > 0) {
        const prev = history[history.length - 1]!;
        displacementFromPrev = parseFloat(
          haversineDistanceMeters(
            { lat: prev.filteredLat, lng: prev.filteredLng },
            { lat: kalmanResult.filteredLat, lng: kalmanResult.filteredLng },
          ).toFixed(2),
        );
      }

      // Compute RMS position deviation across recorded displacements or from native payload
      let rmsPositionDeviation: number | null = null;
      if (typeof pos.rmsPositionDeviation === "number") {
        rmsPositionDeviation = pos.rmsPositionDeviation;
      } else {
        const displacements = history
          .map((r) => r.displacementFromPrev)
          .filter((v): v is number => typeof v === "number");
        if (displacementFromPrev !== undefined) {
          displacements.push(displacementFromPrev);
        }
        if (displacements.length > 0) {
          const sumSq = displacements.reduce((sum, v) => sum + v * v, 0);
          rmsPositionDeviation = parseFloat(Math.sqrt(sumSq / displacements.length).toFixed(2));
        }
      }

      const reading: GpsReading = {
        lat: latitude,
        lng: longitude,
        accuracy, // Preserved raw accuracy
        altitude,
        altitudeAccuracy,
        heading,
        speed,
        timestamp: pos.timestamp,
        filteredLat: kalmanResult.filteredLat,
        filteredLng: kalmanResult.filteredLng,
        filteredEastMeters: kalmanResult.filteredEastMeters,
        filteredNorthMeters: kalmanResult.filteredNorthMeters,
        quality: rawQuality,
        displacementFromPrev,
        sampleIndex: history.length + 1,
        kalmanStatus: kalmanResult.status,
        rmsPositionDeviation,
      };

      // Update state without modifying reported accuracy
      setRawCoords({
        lat: latitude,
        lng: longitude,
        accuracy,
        altitude,
        altitudeAccuracy,
        heading,
        speed,
        timestamp: pos.timestamp,
      });

      setFilteredCoords({
        lat: kalmanResult.filteredLat,
        lng: kalmanResult.filteredLng,
        accuracy, // Raw accuracy is retained
        altitude,
        altitudeAccuracy,
        heading,
        speed,
        timestamp: pos.timestamp,
      });

      setCoords(reading);
      setLastUpdated(new Date(pos.timestamp));
      setKalmanStatus(kalmanResult.status);
      setKalmanEstimatedAccuracy(kalmanResult.kalmanEstimatedAccuracy);

      // Append to history
      readingsRef.current.push(reading);
      const updatedHistory = [...readingsRef.current];
      setReadingsHistory(updatedHistory);
      setReadingsCollected(updatedHistory.length);

      // Track best reading based on smallest reported raw accuracy
      let currentBest = bestReadingRef.current;
      if (!currentBest || reading.accuracy < currentBest.accuracy) {
        currentBest = reading;
        bestReadingRef.current = reading;
        setBestCoords(reading);
        setBestAccuracy(reading.accuracy);
      }

      // Check temporal stability across consecutive readings
      const stability = checkTemporalStability(updatedHistory, 15);
      setIsStable(stability.isStable);
      setConsecutiveGoodCount(stability.consecutiveGoodCount);
      setPositionStability(stability.status);

      // Evaluate geofence with best available reading for continuous diagnostics
      const evalReading = currentBest || reading;
      const evalResult = evaluateGeofence(
        { lat: evalReading.filteredLat, lng: evalReading.filteredLng, accuracy: evalReading.accuracy },
        AUTHORIZED_GEOFENCE_POLYGON,
      );
      setEvaluation(evalResult);

      // Accuracy Evaluation against 20m Acceptance Threshold and 15m Target Goal
      const accInfo = evaluateGpsAccuracy(reading.accuracy);

      // Deterministic Decision:
      // accuracy <= 20m: ACCEPTED -> Geofence verification proceeds immediately!
      // accuracy > 20m: NOT ACCEPTED -> Continue acquiring fresh GPS readings.
      if (accInfo.isAccepted) {
        if (evalResult.isInside) {
          setStatus("inside");
        } else {
          setStatus("outside");
        }
        setStatusMessage(accInfo.statusText);
        setInstructionMessage(accInfo.instructionText);
      } else {
        // If an earlier reading already qualified as accepted, don't revert to insufficient
        if (!currentBest || currentBest.accuracy > GPS_ACCEPTANCE_THRESHOLD_METERS) {
          setStatus("insufficient_accuracy");
        }
        setStatusMessage(accInfo.statusText);
        setInstructionMessage(accInfo.instructionText);
      }

      // Early stop / target settling:
      // If accuracy <= 15m (preferred goal) AND stable fix attained -> settle immediately
      if (reading.accuracy <= GPS_TARGET_ACCURACY_METERS && stability.isStable) {
        stopActiveAcquisition();
        evaluateAndFinalize(currentBest || reading, stability);
        return;
      }
    },
    [evaluateAndFinalize, stopActiveAcquisition],
  );

  const handlePositionError = useCallback(
    (err: { code?: number; message?: string }) => {
      stopActiveAcquisition();

      let newStatus: GpsStatus = "position_unavailable";
      let message = "Unable to determine location.";
      let instruction: string | null = "Move to open sky / enable Precise Location";

      if (err.code === 1) {
        newStatus = "permission_denied";
        message = "GPS permission denied. Please allow location access in settings.";
        instruction = "Enable location permissions in device / browser settings.";
      } else if (err.code === 2) {
        newStatus = "position_unavailable";
        message = "GPS position unavailable. Ensure device location is turned on.";
        instruction = "Turn on device location (GPS) and Precise Location.";
      } else if (err.code === 3) {
        newStatus = "timeout";
        message = "GPS request timed out.";
        instruction = "Move to open sky / enable Precise Location";
      }

      setStatus(newStatus);
      setStatusMessage(message);
      setInstructionMessage(instruction);
      setError(message);
    },
    [stopActiveAcquisition],
  );

  const startAcquisition = useCallback(async (): Promise<GeofenceEvaluation | null> => {
    // Stop any existing session
    stopActiveAcquisition();

    // Reset Kalman filter and acquisition session state for fresh reading
    kalmanRef.current.reset();
    readingsRef.current = [];
    bestReadingRef.current = null;
    setReadingsHistory([]);
    setReadingsCollected(0);
    setBestAccuracy(null);
    setBestCoords(null);
    setRawCoords(null);
    setFilteredCoords(null);
    setKalmanStatus("INITIALIZING");
    setKalmanEstimatedAccuracy(null);
    setIsStable(false);
    setConsecutiveGoodCount(0);
    setPositionStability("MEASURING");
    setAcquisitionTimer(0);
    setIsChecking(true);
    isAcquiringRef.current = true;
    setStatus("acquiring");
    setStatusMessage("Waiting for accurate GPS location...");
    setInstructionMessage("Move to open sky if possible.");
    setError(null);

    return new Promise<GeofenceEvaluation | null>((resolve) => {
      let elapsedSeconds = 0;

      // Start 1-second acquisition timer ticker up to 15 seconds
      timerIntervalRef.current = setInterval(() => {
        elapsedSeconds += 1;
        setAcquisitionTimer(elapsedSeconds);

        if (elapsedSeconds >= maxAcquisitionSeconds) {
          // 15s acquisition window reached
          stopActiveAcquisition();

          const allReadings = readingsRef.current;
          const best = bestReadingRef.current;

          if (allReadings.length === 0 || !best) {
            setStatus("timeout");
            setStatusMessage("GPS accuracy insufficient — Current accuracy: ±—m");
            setInstructionMessage("Acquiring better GPS fix...");
            resolve(null);
            return;
          }

          const stability = checkTemporalStability(allReadings, 15);
          setIsStable(stability.isStable);
          setConsecutiveGoodCount(stability.consecutiveGoodCount);
          setPositionStability(stability.status);

          const evalResult = evaluateAndFinalize(best, stability);
          resolve(evalResult);
        }
      }, 1000);

      // Check if native Android Bridge is available
      const nativeBridge = typeof window !== "undefined" ? (window as any).AndroidLocationBridge : null;

      if (nativeBridge && typeof nativeBridge.startLocationUpdates === "function") {
        // ── 1. NATIVE ANDROID FUSED LOCATION PATH ──
        (window as any).__onNativeLocationUpdate = (payload: any) => {
          if (!payload) return;

          if (payload.status === "LOCATION_DISABLED") {
            handlePositionError({ code: 2, message: "Location is turned off" });
            resolve(null);
            return;
          }

          if (payload.status === "PERMISSION_DENIED") {
            handlePositionError({ code: 1, message: "Location permission denied" });
            resolve(null);
            return;
          }

          if (payload.latitude !== undefined && payload.longitude !== undefined && payload.accuracy !== undefined) {
            handlePositionReading({
              coords: {
                latitude: payload.latitude,
                longitude: payload.longitude,
                accuracy: payload.accuracy,
                altitude: payload.altitude ?? null,
                altitudeAccuracy: payload.altitudeAccuracy ?? null,
                heading: payload.heading ?? null,
                speed: payload.speed ?? null,
              },
              timestamp: payload.timestamp || Date.now(),
              rmsPositionDeviation: typeof payload.rmsPositionDeviation === "number" ? payload.rmsPositionDeviation : null,
            });
          }
        };

        try {
          nativeBridge.startLocationUpdates(maxAcquisitionSeconds);
        } catch (e) {
          console.warn("Native location bridge start failed:", e);
        }
      } else {
        // ── 2. WEB BROWSER FALLBACK PATH ──
        if (typeof window === "undefined" || !navigator.geolocation) {
          setStatus("unsupported");
          setStatusMessage("Geolocation is not supported by this browser.");
          setInstructionMessage(null);
          setError("Geolocation unsupported");
          resolve(null);
          return;
        }

        try {
          watchIdRef.current = navigator.geolocation.watchPosition(
            (pos) => {
              handlePositionReading(pos);
            },
            (err) => {
              handlePositionError(err);
              resolve(null);
            },
            {
              enableHighAccuracy: true,
              timeout: 15000,
              maximumAge: 0,
            },
          );
        } catch (e) {
          console.warn("watchPosition execution notice:", e);
          handlePositionError({
            code: 2,
            message: "Unable to start location watcher",
          });
          resolve(null);
        }
      }
    });
  }, [
    evaluateAndFinalize,
    handlePositionError,
    handlePositionReading,
    maxAcquisitionSeconds,
    stopActiveAcquisition,
  ]);

  const refreshLocation = useCallback(async () => {
    return startAcquisition();
  }, [startAcquisition]);

  const checkLocation = useCallback(
    async (_fresh: boolean = true) => {
      return startAcquisition();
    },
    [startAcquisition],
  );

  const openLocationSettings = useCallback(() => {
    if (typeof window !== "undefined" && (window as any).AndroidLocationBridge?.openLocationSettings) {
      try {
        (window as any).AndroidLocationBridge.openLocationSettings();
      } catch (e) {
        console.warn("openLocationSettings bridge failed:", e);
      }
    }
  }, []);

  useEffect(() => {
    if (autoWatch) {
      void startAcquisition();
    }

    return () => {
      stopActiveAcquisition();
    };
  }, [autoWatch, startAcquisition, stopActiveAcquisition]);

  const currentRawAccuracy = coords ? coords.accuracy : null;
  const gpsQuality = getGpsQuality(currentRawAccuracy);

  const effectiveAccuracy = bestAccuracy !== null ? Math.min(currentRawAccuracy ?? 999, bestAccuracy) : currentRawAccuracy;
  const isAcceptableAccuracy =
    effectiveAccuracy !== null &&
    effectiveAccuracy <= GPS_ACCEPTANCE_THRESHOLD_METERS;
  const isTargetAccuracy =
    effectiveAccuracy !== null &&
    effectiveAccuracy <= GPS_TARGET_ACCURACY_METERS;

  const isInsidePolygonRaw = evaluation ? evaluation.isInside : null;
  // Inside decision requires point inside authoritative polygon AND passed accuracy gate
  const isInsideAuthorized =
    isInsidePolygonRaw === true &&
    (status === "inside" || isAcceptableAccuracy);

  return {
    locationSource,
    coords,
    currentCoords: coords,
    rawCoords,
    filteredCoords,
    bestCoords,
    evaluation,
    isInside: isInsideAuthorized ? true : isInsidePolygonRaw === false ? false : null,
    isInsidePolygon: isInsidePolygonRaw,
    isAcceptableAccuracy,
    isTargetAccuracy,
    status,
    statusMessage,
    instructionMessage,
    isChecking,
    accuracy: currentRawAccuracy,
    rawAccuracy: currentRawAccuracy,
    bestAccuracy,
    kalmanStatus,
    kalmanEstimatedAccuracy,
    gpsQuality,
    positionStability,
    readingsCollected,
    readingsHistory,
    acquisitionTimer,
    maxAcquisitionSeconds,
    isStable,
    consecutiveGoodCount,
    distanceToBoundary: evaluation ? evaluation.distanceToBoundaryMeters : null,
    distanceToCentroid: evaluation ? evaluation.distanceToCentroidMeters : null,
    lastUpdated,
    error,
    refreshLocation,
    checkLocation,
    openLocationSettings,
    // Expose RMS deviation from the latest reading (if available)
    rmsPositionDeviation: readingsHistory.length > 0 ? (readingsHistory[readingsHistory.length - 1]?.rmsPositionDeviation ?? null) : null,
    polygon: AUTHORIZED_GEOFENCE_POLYGON,
  };
}
