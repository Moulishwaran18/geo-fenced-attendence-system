/**
 * CampusAttend Authoritative Geofence & Point-in-Polygon (PIP) Service.
 *
 * The following 19 authoritative coordinates define the ONLY authorized campus attendance region:
 * C1  = 11.679113056127784, 78.12389462165308
 * C2  = 11.679160653348573, 78.1251229550977
 * C3  = 11.679072439799588, 78.12580219547301
 * C4  = 11.678915085838511, 78.12659829439393
 * C5  = 11.67857653610425,  78.12706572862274
 * C6  = 11.677855225878366, 78.1268821218973
 * C7  = 11.677005135877979, 78.12680385127157
 * C8  = 11.676963779359658, 78.12619810348153
 * C9  = 11.675808384169112, 78.12611721999878
 * C10 = 11.67548101155477,  78.12632747328921
 * C11 = 11.675225395251344, 78.12546783441684
 * C12 = 11.674880184146973, 78.12470095781757
 * C13 = 11.67506203954446,  78.12467072803454
 * C14 = 11.675345395390822, 78.12439973963578
 * C15 = 11.675557255409673, 78.1241730162712
 * C16 = 11.676220110497038, 78.12411693452746
 * C17 = 11.677404862894116, 78.12403601056346
 * C18 = 11.678027388807743, 78.12399041301013
 * C19 = 11.679113056127784, 78.12389462165308
 * Connected: C1 → C2 → C3 → ... → C19 → C1
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
 * Authoritative 19-point Polygon Coordinates (Strict Order C1 -> C19 -> C1).
 */
export const AUTHORIZED_GEOFENCE_POLYGON: LatLng[] = [
  { lat: 11.679113056127784, lng: 78.12389462165308 }, // C1
  { lat: 11.679160653348573, lng: 78.1251229550977 },  // C2
  { lat: 11.679072439799588, lng: 78.12580219547301 }, // C3
  { lat: 11.678915085838511, lng: 78.12659829439393 }, // C4
  { lat: 11.67857653610425,  lng: 78.12706572862274 }, // C5
  { lat: 11.677855225878366, lng: 78.1268821218973 },  // C6
  { lat: 11.677005135877979, lng: 78.12680385127157 }, // C7
  { lat: 11.676963779359658, lng: 78.12619810348153 }, // C8
  { lat: 11.675808384169112, lng: 78.12611721999878 }, // C9
  { lat: 11.67548101155477,  lng: 78.12632747328921 }, // C10
  { lat: 11.675225395251344, lng: 78.12546783441684 }, // C11
  { lat: 11.674880184146973, lng: 78.12470095781757 }, // C12
  { lat: 11.67506203954446,  lng: 78.12467072803454 }, // C13
  { lat: 11.675345395390822, lng: 78.12439973963578 }, // C14
  { lat: 11.675557255409673, lng: 78.1241730162712 },  // C15
  { lat: 11.676220110497038, lng: 78.12411693452746 }, // C16
  { lat: 11.677404862894116, lng: 78.12403601056346 }, // C17
  { lat: 11.678027388807743, lng: 78.12399041301013 }, // C18
  { lat: 11.679113056127784, lng: 78.12389462165308 }, // C19
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
