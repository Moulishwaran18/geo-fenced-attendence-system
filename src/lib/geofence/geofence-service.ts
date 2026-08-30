/**
 * CampusAttend Authoritative Geofence & Point-in-Polygon (PIP) Service.
 *
 * The following 5 authoritative coordinates define the ONLY authorized campus attendance region:
 * C1 = 11.680071, 78.121811
 * C2 = 11.680239, 78.121575
 * C3 = 11.680607, 78.121628
 * C4 = 11.680439, 78.122047
 * C5 = 11.680176, 78.122057
 * Connected strictly: C1 → C2 → C3 → C4 → C5 → C1
 */

export interface LatLng {
  lat: number;
  lng: number;
}

export interface GeofenceEvaluation {
  isInside: boolean;
  distanceToBoundaryMeters: number;
  distanceToCentroidMeters: number;
  nearestVertexIndex: number;
  lat: number;
  lng: number;
  accuracy?: number | undefined;
  timestamp: string;
  relationship: string;
}

/**
 * Authoritative 5-point Polygon Coordinates (Strict Order C1 -> C2 -> C3 -> C4 -> C5 -> C1).
 */
export const AUTHORIZED_GEOFENCE_POLYGON: LatLng[] = [
  { lat: 11.680071, lng: 78.121811 }, // C1
  { lat: 11.680239, lng: 78.121575 }, // C2
  { lat: 11.680607, lng: 78.121628 }, // C3
  { lat: 11.680439, lng: 78.122047 }, // C4
  { lat: 11.680176, lng: 78.122057 }, // C5
];

/**
 * Calculates whether a point is strictly inside a polygon using the
 * Ray-Casting algorithm (Jordan Curve Theorem / even-odd rule).
 *
 * @param point Device GPS coordinate { lat, lng }
 * @param polygon Polygon vertices in clockwise or counter-clockwise order
 * @returns boolean true if inside, false if outside
 */
export function isPointInPolygon(
  point: LatLng,
  polygon: LatLng[] = AUTHORIZED_GEOFENCE_POLYGON,
): boolean {
  if (!point || typeof point.lat !== "number" || typeof point.lng !== "number" || isNaN(point.lat) || isNaN(point.lng)) {
    return false;
  }

  const x = point.lng;
  const y = point.lat;
  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i]!.lng;
    const yi = polygon[i]!.lat;
    const xj = polygon[j]!.lng;
    const yj = polygon[j]!.lat;

    // Check if the point lies on a horizontal ray intersecting the polygon edge
    const intersect =
      yi > y !== yj > y &&
      x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;

    if (intersect) {
      inside = !inside;
    }
  }

  return inside;
}

/**
 * Earth radius in meters (WGS-84 mean radius)
 */
const EARTH_RADIUS_METERS = 6371000;

/**
 * Calculates great-circle distance between two GPS coordinates using the Haversine formula.
 */
export function haversineDistanceMeters(p1: LatLng, p2: LatLng): number {
  const dLat = ((p2.lat - p1.lat) * Math.PI) / 180;
  const dLng = ((p2.lng - p1.lng) * Math.PI) / 180;
  const lat1 = (p1.lat * Math.PI) / 180;
  const lat2 = (p2.lat * Math.PI) / 180;

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLng / 2) * Math.sin(dLng / 2) * Math.cos(lat1) * Math.cos(lat2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return EARTH_RADIUS_METERS * c;
}

/**
 * Calculates the centroid of the polygon.
 */
export function getPolygonCentroid(polygon: LatLng[] = AUTHORIZED_GEOFENCE_POLYGON): LatLng {
  let sumLat = 0;
  let sumLng = 0;
  for (const pt of polygon) {
    sumLat += pt.lat;
    sumLng += pt.lng;
  }
  return {
    lat: sumLat / polygon.length,
    lng: sumLng / polygon.length,
  };
}

/**
 * Calculates distance from a point to a line segment (defined by two points) in meters.
 */
export function distanceToSegmentMeters(p: LatLng, v: LatLng, w: LatLng): number {
  // Convert lat/lng to local Euclidean meters relative to point v
  const latFactor = (Math.PI / 180) * EARTH_RADIUS_METERS;
  const lngFactor = (Math.PI / 180) * EARTH_RADIUS_METERS * Math.cos(((v.lat + w.lat) / 2 * Math.PI) / 180);

  const px = (p.lng - v.lng) * lngFactor;
  const py = (p.lat - v.lat) * latFactor;

  const wx = (w.lng - v.lng) * lngFactor;
  const wy = (w.lat - v.lat) * latFactor;

  const l2 = wx * wx + wy * wy;
  if (l2 === 0) {
    return Math.sqrt(px * px + py * py);
  }

  // Projection scalar t on segment [0, 1]
  const t = Math.max(0, Math.min(1, (px * wx + py * wy) / l2));
  const projX = t * wx;
  const projY = t * wy;

  const dx = px - projX;
  const dy = py - projY;

  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Calculates the shortest distance in meters from a point to the polygon perimeter.
 */
export function distanceToPolygonBoundaryMeters(
  point: LatLng,
  polygon: LatLng[] = AUTHORIZED_GEOFENCE_POLYGON,
): { minDistance: number; nearestVertexIndex: number } {
  let minDistance = Infinity;
  let nearestVertexIndex = 0;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const d = distanceToSegmentMeters(point, polygon[j]!, polygon[i]!);
    if (d < minDistance) {
      minDistance = d;
      nearestVertexIndex = i;
    }
  }

  return { minDistance, nearestVertexIndex };
}

/**
 * Complete Geofence Evaluation for a device GPS position.
 */
export function evaluateGeofence(
  coords: { lat: number; lng: number; accuracy?: number },
  polygon: LatLng[] = AUTHORIZED_GEOFENCE_POLYGON,
): GeofenceEvaluation {
  const pt: LatLng = { lat: coords.lat, lng: coords.lng };
  const isInside = isPointInPolygon(pt, polygon);
  const { minDistance, nearestVertexIndex } = distanceToPolygonBoundaryMeters(pt, polygon);
  const centroid = getPolygonCentroid(polygon);
  const distToCentroid = haversineDistanceMeters(pt, centroid);

  let relationship = "";
  if (isInside) {
    relationship = `Inside authorized region (${minDistance.toFixed(1)}m from boundary · ${distToCentroid.toFixed(1)}m from center)`;
  } else {
    relationship = `Outside authorized region (${minDistance.toFixed(1)}m from perimeter)`;
  }

  return {
    isInside,
    distanceToBoundaryMeters: parseFloat(minDistance.toFixed(2)),
    distanceToCentroidMeters: parseFloat(distToCentroid.toFixed(2)),
    nearestVertexIndex,
    lat: coords.lat,
    lng: coords.lng,
    accuracy: coords.accuracy !== undefined ? parseFloat(coords.accuracy.toFixed(1)) : undefined,
    timestamp: new Date().toISOString(),
    relationship,
  };
}
