package com.campusattend.biometric.location

/**
 * Authoritative 5-Point Campus Geofence Manager for Native Android.
 * Evaluates Jordan curve ray-casting point-in-polygon containment on Kalman-filtered coordinates.
 */
object GeofenceManager {
    data class LatLng(val lat: Double, val lng: Double)

    /**
     * Authoritative 13-Point Polygon Vertices:
     * C1 -> C2 -> ... -> C13 -> C1
     */
    val AUTHORIZED_POLYGON = listOf(
        LatLng(11.675651510482604, 78.12402220170895), // C1
        LatLng(11.675657082681333, 78.12382305416799), // C2
        LatLng(11.675768526632474, 78.12359545697831), // C3
        LatLng(11.675857681761121, 78.12339630943734), // C4
        LatLng(11.676125146975094, 78.1228443862524),  // C5
        LatLng(11.676370323194567, 78.12244609117047), // C6
        LatLng(11.676414900665728, 78.12241764152176), // C7
        LatLng(11.676448333764391, 78.12143897360616), // C8
        LatLng(11.676905252375372, 78.12147880311436), // C9
        LatLng(11.676977690622595, 78.12159260170921), // C10
        LatLng(11.67708913404289,  78.12222418391055), // C11
        LatLng(11.677990932044441, 78.12235439874642), // C12
        LatLng(11.677979915759753, 78.1237830407748)   // C13
    )

    val CENTROID = LatLng(11.67655665, 78.12272440)

    /**
     * Ray-casting Jordan curve point-in-polygon containment.
     */
    fun isPointInPolygon(point: LatLng, polygon: List<LatLng> = AUTHORIZED_POLYGON): Boolean {
        var inside = false
        val n = polygon.size
        var j = n - 1
        for (i in 0 until n) {
            val xi = polygon[i].lng
            val yi = polygon[i].lat
            val xj = polygon[j].lng
            val yj = polygon[j].lat

            val intersect = ((yi > point.lat) != (yj > point.lat)) &&
                    (point.lng < (xj - xi) * (point.lat - yi) / (yj - yi) + xi)
            if (intersect) {
                inside = !inside
            }
            j = i
        }
        return inside
    }

    /**
     * Calculates distance from a coordinate point to the polygon boundary in meters.
     */
    fun distanceToBoundaryMeters(point: LatLng, polygon: List<LatLng> = AUTHORIZED_POLYGON): Double {
        val earthRadius = 6371000.0
        val latFactor = (Math.PI / 180.0) * earthRadius
        val lngFactor = (Math.PI / 180.0) * earthRadius * kotlin.math.cos(point.lat * Math.PI / 180.0)
        var minDistance = Double.MAX_VALUE
        val n = polygon.size
        var j = n - 1
        for (i in 0 until n) {
            val v = polygon[j]
            val w = polygon[i]
            val px = (point.lng - v.lng) * lngFactor
            val py = (point.lat - v.lat) * latFactor
            val wx = (w.lng - v.lng) * lngFactor
            val wy = (w.lat - v.lat) * latFactor
            val l2 = wx * wx + wy * wy
            val d = if (l2 == 0.0) {
                kotlin.math.sqrt(px * px + py * py)
            } else {
                val t = ((px * wx + py * wy) / l2).coerceIn(0.0, 1.0)
                val dx = px - t * wx
                val dy = py - t * wy
                kotlin.math.sqrt(dx * dx + dy * dy)
            }
            if (d < minDistance) {
                minDistance = d
            }
            j = i
        }
        return minDistance
    }

    enum class GeofenceContainmentStatus {
        INSIDE,
        OUTSIDE,
        UNCERTAIN
    }

    /**
     * Evaluates containment considering GPS horizontal accuracy uncertainty circle.
     * If point is inside but distance to edge is less than raw accuracy, uncertainty overlaps boundary.
     */
    fun evaluateContainment(
        point: LatLng,
        rawAccuracyMeters: Float,
        polygon: List<LatLng> = AUTHORIZED_POLYGON
    ): Pair<GeofenceContainmentStatus, Double> {
        val inside = isPointInPolygon(point, polygon)
        val dist = distanceToBoundaryMeters(point, polygon)
        val status = when {
            !inside -> GeofenceContainmentStatus.OUTSIDE
            dist < rawAccuracyMeters -> GeofenceContainmentStatus.UNCERTAIN
            else -> GeofenceContainmentStatus.INSIDE
        }
        return Pair(status, dist)
    }

    /**
     * Quality Policy:
     * < 10m: EXCELLENT (Optimization target goal reached)
     * <= 20m: GOOD (Accepted fix, improving toward <10m)
     * <= 50m: ACQUIRING / WAIT
     * > 50m: UNRELIABLE
     */
    fun getGpsQuality(accuracyMeters: Float): String {
        return when {
            accuracyMeters < 10f -> "EXCELLENT"
            accuracyMeters <= 20f -> "GOOD"
            accuracyMeters <= 50f -> "ACQUIRING / WAIT"
            else -> "UNRELIABLE"
        }
    }

    /**
     * Strict 3-Factor Authorization Rule:
     * wifiAuthorized AND gpsAuthorized (inside AND accuracy <= 20m AND not boundary-uncertain) AND faceAuthenticated -> ALLOWED
     */
    fun isAttendanceAllowed(
        wifiAuthorized: Boolean,
        gpsInsideGeofence: Boolean,
        rawAccuracyMeters: Float,
        isGpsStable: Boolean,
        faceAuthenticated: Boolean,
        isBoundaryUncertain: Boolean = false
    ): Boolean {
        val gpsValid = gpsInsideGeofence && !isBoundaryUncertain && rawAccuracyMeters <= 20f && isGpsStable
        return wifiAuthorized && gpsValid && faceAuthenticated
    }
}
