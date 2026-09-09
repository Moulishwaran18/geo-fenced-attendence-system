package com.campusattend.biometric.location

/**
 * Authoritative 5-Point Campus Geofence Manager for Native Android.
 * Evaluates Jordan curve ray-casting point-in-polygon containment on Kalman-filtered coordinates.
 */
object GeofenceManager {
    data class LatLng(val lat: Double, val lng: Double)

    /**
     * Authoritative 19-Point Polygon Vertices:
     * C1 -> C2 -> ... -> C19 -> C1
     */
    val AUTHORIZED_POLYGON = listOf(
        LatLng(11.679113056127784, 78.12389462165308), // C1
        LatLng(11.679160653348573, 78.1251229550977),  // C2
        LatLng(11.679072439799588, 78.12580219547301), // C3
        LatLng(11.678915085838511, 78.12659829439393), // C4
        LatLng(11.67857653610425,  78.12706572862274), // C5
        LatLng(11.677855225878366, 78.1268821218973),  // C6
        LatLng(11.677005135877979, 78.12680385127157), // C7
        LatLng(11.676963779359658, 78.12619810348153), // C8
        LatLng(11.675808384169112, 78.12611721999878), // C9
        LatLng(11.67548101155477,  78.12632747328921), // C10
        LatLng(11.675225395251344, 78.12546783441684), // C11
        LatLng(11.674880184146973, 78.12470095781757), // C12
        LatLng(11.67506203954446,  78.12467072803454), // C13
        LatLng(11.675345395390822, 78.12439973963578), // C14
        LatLng(11.675557255409673, 78.1241730162712),  // C15
        LatLng(11.676220110497038, 78.12411693452746), // C16
        LatLng(11.677404862894116, 78.12403601056346), // C17
        LatLng(11.678027388807743, 78.12399041301013), // C18
        LatLng(11.679113056127784, 78.12389462165308)  // C19
    )

    val CENTROID = LatLng(11.67709405, 78.12527699)

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
