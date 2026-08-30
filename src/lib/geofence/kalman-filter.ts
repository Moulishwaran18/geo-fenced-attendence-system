/**
 * CampusAttend 2D Constant-Velocity Kalman Filter for GPS Position Stabilization.
 *
 * Designed to smooth positional measurement jitter without fabricating or altering
 * the device's authoritative raw GPS accuracy value.
 *
 * Pipeline:
 * 1. Convert WGS-84 Lat/Lng to local tangent-plane East/North coordinates (meters)
 *    centered near the campus geofence centroid.
 * 2. Predict next state using constant-velocity transition model [x, y, vx, vy].
 * 3. Form dynamic measurement noise covariance R based on exact raw GPS accuracy.
 * 4. Compute Kalman gain and update filtered position.
 * 5. Convert filtered East/North position back to WGS-84 Lat/Lng for UI rendering
 *    and point-in-polygon evaluation.
 */

import { getPolygonCentroid, AUTHORIZED_GEOFENCE_POLYGON, type LatLng } from "./geofence-service.ts";

const EARTH_RADIUS_METERS = 6371000;

/**
 * Default origin coordinate for the local tangent plane (centered at geofence centroid).
 */
export const DEFAULT_GEOFENCE_ORIGIN: LatLng = getPolygonCentroid(AUTHORIZED_GEOFENCE_POLYGON);

/**
 * Converts WGS-84 Latitude/Longitude to local East/North Cartesian meters
 * relative to a tangent plane origin.
 */
export function latLngToLocalMeters(
  point: LatLng,
  origin: LatLng = DEFAULT_GEOFENCE_ORIGIN,
): { x: number; y: number } {
  const latFactor = (Math.PI / 180) * EARTH_RADIUS_METERS;
  const lngFactor =
    (Math.PI / 180) *
    EARTH_RADIUS_METERS *
    Math.cos((origin.lat * Math.PI) / 180);

  const x = (point.lng - origin.lng) * lngFactor; // East in meters
  const y = (point.lat - origin.lat) * latFactor; // North in meters

  return { x, y };
}

/**
 * Converts local East/North Cartesian meters back to WGS-84 Latitude/Longitude.
 */
export function localMetersToLatLng(
  local: { x: number; y: number },
  origin: LatLng = DEFAULT_GEOFENCE_ORIGIN,
): LatLng {
  const latFactor = (Math.PI / 180) * EARTH_RADIUS_METERS;
  const lngFactor =
    (Math.PI / 180) *
    EARTH_RADIUS_METERS *
    Math.cos((origin.lat * Math.PI) / 180);

  const lat = origin.lat + local.y / latFactor;
  const lng = origin.lng + local.x / lngFactor;

  return { lat, lng };
}

export interface KalmanFilteredPosition {
  rawLat: number;
  rawLng: number;
  rawAccuracy: number;
  filteredLat: number;
  filteredLng: number;
  filteredEastMeters: number;
  filteredNorthMeters: number;
  estimatedVelocityMps: number;
  kalmanEstimatedAccuracy: number;
  sampleCount: number;
  dtSeconds: number;
  status: "INITIALIZING" | "ACTIVE" | "SETTLED";
}

/**
 * 2D Constant-Velocity Kalman Filter for GPS Position Smoothing.
 *
 * State Vector: x = [x (East), y (North), vx (East Vel), vy (North Vel)]^T
 * Measurement:  z = [x (East), y (North)]^T
 */
export class GpsKalmanFilter {
  // State: [x, y, vx, vy]
  private state: [number, number, number, number] = [0, 0, 0, 0];

  // Covariance matrix P (4x4)
  private P: number[][] = [
    [100, 0, 0, 0],
    [0, 100, 0, 0],
    [10, 0, 10, 0],
    [0, 10, 0, 10],
  ];

  private lastTimestamp: number | null = null;
  private sampleCount: number = 0;
  private origin: LatLng;
  private processNoiseAcc: number;

  /**
   * @param origin Local tangent plane anchor coordinate
   * @param processNoiseAcc Acceleration variance q (m/s^2)^2 for process noise (default: 0.5)
   */
  constructor(
    origin: LatLng = DEFAULT_GEOFENCE_ORIGIN,
    processNoiseAcc: number = 0.5,
  ) {
    this.origin = origin;
    this.processNoiseAcc = processNoiseAcc;
    this.reset();
  }

  /**
   * Resets filter state and covariance.
   */
  public reset(initialReading?: {
    lat: number;
    lng: number;
    accuracy: number;
    timestamp: number;
  }): void {
    this.sampleCount = 0;
    this.lastTimestamp = null;

    if (initialReading) {
      const local = latLngToLocalMeters(
        { lat: initialReading.lat, lng: initialReading.lng },
        this.origin,
      );
      const varPos = Math.max(initialReading.accuracy * initialReading.accuracy, 4.0);
      this.state = [local.x, local.y, 0, 0];
      this.P = [
        [varPos, 0, 0, 0],
        [0, varPos, 0, 0],
        [0, 0, 4.0, 0],
        [0, 0, 0, 4.0],
      ];
      this.lastTimestamp = initialReading.timestamp;
      this.sampleCount = 1;
    } else {
      this.state = [0, 0, 0, 0];
      this.P = [
        [100, 0, 0, 0],
        [0, 100, 0, 0],
        [10, 0, 10, 0],
        [0, 10, 0, 10],
      ];
    }
  }

  /**
   * Updates filter state with a fresh raw GPS reading.
   *
   * @param reading Raw GPS measurement from navigator.geolocation
   * @returns KalmanFilteredPosition containing both raw and smoothed coordinates
   */
  public update(reading: {
    lat: number;
    lng: number;
    accuracy: number;
    timestamp: number;
  }): KalmanFilteredPosition {
    const rawPos = { lat: reading.lat, lng: reading.lng };
    const measurement = latLngToLocalMeters(rawPos, this.origin);

    // Initial fix handling
    if (this.sampleCount === 0 || this.lastTimestamp === null) {
      this.reset(reading);
      return {
        rawLat: reading.lat,
        rawLng: reading.lng,
        rawAccuracy: reading.accuracy,
        filteredLat: reading.lat,
        filteredLng: reading.lng,
        filteredEastMeters: measurement.x,
        filteredNorthMeters: measurement.y,
        estimatedVelocityMps: 0,
        kalmanEstimatedAccuracy: reading.accuracy,
        sampleCount: 1,
        dtSeconds: 0,
        status: "INITIALIZING",
      };
    }

    // Time delta calculation in seconds
    let dt = (reading.timestamp - this.lastTimestamp) / 1000;
    if (dt <= 0 || isNaN(dt)) {
      dt = 1.0;
    }
    // Cap dt at 10 seconds to avoid massive process noise on background pauses
    if (dt > 10.0) {
      dt = 10.0;
    }
    this.lastTimestamp = reading.timestamp;
    this.sampleCount++;

    // -------------------------------------------------------------------------
    // 1. PREDICT STEP
    // -------------------------------------------------------------------------
    const [x, y, vx, vy] = this.state;

    // x_pred = F * x
    const xPred = x + vx * dt;
    const yPred = y + vy * dt;
    const vxPred = vx;
    const vyPred = vy;

    // F * P * F^T + Q
    const q = this.processNoiseAcc;
    const dt2 = dt * dt;
    const dt3 = dt2 * dt;

    // Process noise matrix Q
    const q00 = q * (dt3 / 3);
    const q02 = q * (dt2 / 2);
    const q11 = q * (dt3 / 3);
    const q13 = q * (dt2 / 2);
    const q22 = q * dt;
    const q33 = q * dt;

    // Predicted Covariance P_pred = F * P * F^T + Q
    const P = this.P;
    const P00 = P[0]![0]!;
    const P01 = P[0]![1]!;
    const P02 = P[0]![2]!;
    const P03 = P[0]![3]!;
    const P10 = P[1]![0]!;
    const P11 = P[1]![1]!;
    const P12 = P[1]![2]!;
    const P13 = P[1]![3]!;
    const P20 = P[2]![0]!;
    const P21 = P[2]![1]!;
    const P22 = P[2]![2]!;
    const P23 = P[2]![3]!;
    const P30 = P[3]![0]!;
    const P31 = P[3]![1]!;
    const P32 = P[3]![2]!;
    const P33 = P[3]![3]!;

    const pPred00 = P00 + dt * (P20 + P02) + dt2 * P22 + q00;
    const pPred01 = P01 + dt * (P21 + P03) + dt2 * P23;
    const pPred02 = P02 + dt * P22 + q02;
    const pPred03 = P03 + dt * P23;

    const pPred10 = P10 + dt * (P30 + P12) + dt2 * P32;
    const pPred11 = P11 + dt * (P31 + P13) + dt2 * P33 + q11;
    const pPred12 = P12 + dt * P32;
    const pPred13 = P13 + dt * P33 + q13;

    const pPred20 = P20 + dt * P22 + q02;
    const pPred21 = P21 + dt * P23;
    const pPred22 = P22 + q22;
    const pPred23 = P23;

    const pPred30 = P30 + dt * P32;
    const pPred31 = P31 + dt * P33 + q13;
    const pPred32 = P32;
    const pPred33 = P33 + q33;

    // -------------------------------------------------------------------------
    // 2. MEASUREMENT NOISE DERIVED FROM RAW GPS ACCURACY
    // -------------------------------------------------------------------------
    // Use raw GPS horizontal accuracy standard deviation (meters). Floor at 1.0m.
    const sigma = Math.max(reading.accuracy, 1.0);
    const varMeas = sigma * sigma;

    // Innovation S = H * P_pred * H^T + R
    const S00 = pPred00 + varMeas;
    const S01 = pPred01;
    const S10 = pPred10;
    const S11 = pPred11 + varMeas;

    // Inverse of 2x2 matrix S
    const detS = S00 * S11 - S01 * S10;
    const invDetS = detS !== 0 ? 1.0 / detS : 1e-6;
    const invS00 = S11 * invDetS;
    const invS01 = -S01 * invDetS;
    const invS10 = -S10 * invDetS;
    const invS11 = S00 * invDetS;

    // Kalman Gain K = P_pred * H^T * inv(S)  (4x2 matrix)
    // (P_pred * H^T) col0 = [pPred00, pPred10, pPred20, pPred30]
    // (P_pred * H^T) col1 = [pPred01, pPred11, pPred21, pPred31]
    const K00 = pPred00 * invS00 + pPred01 * invS10;
    const K01 = pPred00 * invS01 + pPred01 * invS11;

    const K10 = pPred10 * invS00 + pPred11 * invS10;
    const K11 = pPred10 * invS01 + pPred11 * invS11;

    const K20 = pPred20 * invS00 + pPred21 * invS10;
    const K21 = pPred20 * invS01 + pPred21 * invS11;

    const K30 = pPred30 * invS00 + pPred31 * invS10;
    const K31 = pPred30 * invS01 + pPred31 * invS11;

    // -------------------------------------------------------------------------
    // 3. UPDATE STATE
    // -------------------------------------------------------------------------
    // Innovation y = z - H * x_pred
    const y0 = measurement.x - xPred;
    const y1 = measurement.y - yPred;

    const xUpd = xPred + (K00 * y0 + K01 * y1);
    const yUpd = yPred + (K10 * y0 + K11 * y1);
    const vxUpd = vxPred + (K20 * y0 + K21 * y1);
    const vyUpd = vyPred + (K30 * y0 + K31 * y1);

    this.state = [xUpd, yUpd, vxUpd, vyUpd];

    // -------------------------------------------------------------------------
    // 4. UPDATE COVARIANCE P = (I - K * H) * P_pred
    // -------------------------------------------------------------------------
    // I - K * H:
    // row0: [1 - K00, -K01, 0, 0]
    // row1: [-K10, 1 - K11, 0, 0]
    // row2: [-K20, -K21, 1, 0]
    // row3: [-K30, -K31, 0, 1]

    const I_KH00 = 1 - K00;
    const I_KH01 = -K01;
    const I_KH10 = -K10;
    const I_KH11 = 1 - K11;
    const I_KH20 = -K20;
    const I_KH21 = -K21;
    const I_KH30 = -K30;
    const I_KH31 = -K31;

    const newP00 = I_KH00 * pPred00 + I_KH01 * pPred10;
    const newP01 = I_KH00 * pPred01 + I_KH01 * pPred11;
    const newP02 = I_KH00 * pPred02 + I_KH01 * pPred12;
    const newP03 = I_KH00 * pPred03 + I_KH01 * pPred13;

    const newP10 = I_KH10 * pPred00 + I_KH11 * pPred10;
    const newP11 = I_KH10 * pPred01 + I_KH11 * pPred11;
    const newP12 = I_KH10 * pPred02 + I_KH11 * pPred12;
    const newP13 = I_KH10 * pPred03 + I_KH11 * pPred13;

    const newP20 = I_KH20 * pPred00 + I_KH21 * pPred10 + pPred20;
    const newP21 = I_KH20 * pPred01 + I_KH21 * pPred11 + pPred21;
    const newP22 = I_KH20 * pPred02 + I_KH21 * pPred12 + pPred22;
    const newP23 = I_KH20 * pPred03 + I_KH21 * pPred13 + pPred23;

    const newP30 = I_KH30 * pPred00 + I_KH31 * pPred10 + pPred30;
    const newP31 = I_KH30 * pPred01 + I_KH31 * pPred11 + pPred31;
    const newP32 = I_KH30 * pPred02 + I_KH31 * pPred12 + pPred32;
    const newP33 = I_KH30 * pPred03 + I_KH31 * pPred13 + pPred33;

    // Enforce symmetry
    this.P = [
      [newP00, (newP01 + newP10) / 2, (newP02 + newP20) / 2, (newP03 + newP30) / 2],
      [(newP10 + newP01) / 2, newP11, (newP12 + newP21) / 2, (newP13 + newP31) / 2],
      [(newP20 + newP02) / 2, (newP21 + newP12) / 2, newP22, (newP23 + newP32) / 2],
      [(newP30 + newP03) / 2, (newP31 + newP13) / 2, (newP32 + newP23) / 2, newP33],
    ];

    // -------------------------------------------------------------------------
    // 5. CONVERT FILTERED STATE BACK TO LAT/LNG
    // -------------------------------------------------------------------------
    const filteredLatLng = localMetersToLatLng({ x: xUpd, y: yUpd }, this.origin);
    const speed = Math.sqrt(vxUpd * vxUpd + vyUpd * vyUpd);
    const kalmanEstAcc = Math.sqrt((this.P[0]![0]! + this.P[1]![1]!) / 2);

    const status: "INITIALIZING" | "ACTIVE" | "SETTLED" =
      this.sampleCount < 2 ? "INITIALIZING" : this.sampleCount >= 4 ? "SETTLED" : "ACTIVE";

    return {
      rawLat: reading.lat,
      rawLng: reading.lng,
      rawAccuracy: reading.accuracy,
      filteredLat: filteredLatLng.lat,
      filteredLng: filteredLatLng.lng,
      filteredEastMeters: parseFloat(xUpd.toFixed(3)),
      filteredNorthMeters: parseFloat(yUpd.toFixed(3)),
      estimatedVelocityMps: parseFloat(speed.toFixed(2)),
      kalmanEstimatedAccuracy: parseFloat(kalmanEstAcc.toFixed(1)),
      sampleCount: this.sampleCount,
      dtSeconds: parseFloat(dt.toFixed(2)),
      status,
    };
  }

  /**
   * Returns the current estimated position in WGS-84 coordinates.
   */
  public getFilteredLatLng(): LatLng {
    return localMetersToLatLng(
      { x: this.state[0], y: this.state[1] },
      this.origin,
    );
  }

  /**
   * Returns internal state vector.
   */
  public getState(): { x: number; y: number; vx: number; vy: number } {
    return {
      x: this.state[0],
      y: this.state[1],
      vx: this.state[2],
      vy: this.state[3],
    };
  }
}
