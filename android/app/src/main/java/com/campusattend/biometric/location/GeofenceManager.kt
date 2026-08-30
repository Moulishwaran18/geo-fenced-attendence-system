package com.campusattend.biometric.location

/**
 * Authoritative 5-Point Campus Geofence Manager for Native Android.
 * Evaluates Jordan curve ray-casting point-in-polygon containment on Kalman-filtered coordinates.
 */
object GeofenceManager {
    data class LatLng(val lat: Double, val lng: Double)

    /**
     * Authoritative 5-Point Polygon Vertices:
     * C1 -> C2 -> C3 -> C4 -> C5 -> C1
     */
    val AUTHORIZED_POLYGON = listOf(
        LatLng(11.680071, 78.121811), // C1
        LatLng(11.680239, 78.121575), // C2
        LatLng(11.680607, 78.121628), // C3
        LatLng(11.680439, 78.122047), // C4
        LatLng(11.680176, 78.122057)  // C5
    )

    val CENTROID = LatLng(11.68030640, 78.12182360)

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
     * Quality Policy:
     * <= 10m: EXCELLENT
     * <= 20m: GOOD
     * <= 50m: ACQUIRING / WAIT
     * > 50m: UNRELIABLE
     */
    fun getGpsQuality(accuracyMeters: Float): String {
        return when {
            accuracyMeters <= 10f -> "EXCELLENT"
            accuracyMeters <= 20f -> "GOOD"
            accuracyMeters <= 50f -> "ACQUIRING / WAIT"
            else -> "UNRELIABLE"
        }
    }

    /**
     * Strict 3-Factor Authorization Rule:
     * wifiAuthorized AND gpsAuthorized (inside AND accuracy <= 20m) AND faceAuthenticated -> ALLOWED
     */
    fun isAttendanceAllowed(
        wifiAuthorized: Boolean,
        gpsInsideGeofence: Boolean,
        rawAccuracyMeters: Float,
        isGpsStable: Boolean,
        faceAuthenticated: Boolean
    ): Boolean {
        val gpsValid = gpsInsideGeofence && rawAccuracyMeters <= 20f && isGpsStable
        return wifiAuthorized && gpsValid && faceAuthenticated
    }
}
