package com.campusattend.biometric.location

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Bundle
import android.os.Looper
import android.provider.Settings
import android.util.Log
import androidx.core.content.ContextCompat
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.google.android.gms.tasks.CancellationTokenSource
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.sin
import kotlin.math.sqrt

data class NativeLocationReading(
    val sampleIndex: Int,
    val rawLatitude: Double,
    val rawLongitude: Double,
    val rawAccuracyMeters: Float,
    val filteredLatitude: Double,
    val filteredLongitude: Double,
    val timestamp: Long,
    val provider: String,
    val quality: String, // EXCELLENT, GOOD, ACQUIRING, UNRELIABLE
    val displacementMeters: Double,
    val isInsidePolygon: Boolean,
    val kalmanStatus: String
)

data class NativeLocationSessionState(
    val status: String, // IDLE, ACQUIRING, INSIDE, OUTSIDE, INSUFFICIENT_ACCURACY, PERMISSION_DENIED, LOCATION_DISABLED
    val rawAccuracy: Float?,
    val bestAccuracy: Float?,
    val readingsCollected: Int,
    val positionStability: String, // STABLE, UNSTABLE, MEASURING
    val consecutiveGoodCount: Int,
    val isInsideGeofence: Boolean?,
    val isAttendanceAllowed: Boolean,
    val currentReading: NativeLocationReading?,
    val bestReading: NativeLocationReading? = null,
    val readingsHistory: List<NativeLocationReading>,
    val errorMessage: String? = null
)

/**
 * Native Android Optimized High-Accuracy Dual Location Service.
 * Combines Google Play Services FusedLocationProviderClient (PRIORITY_HIGH_ACCURACY)
 * with direct LocationManager.GPS_PROVIDER hardware radio access.
 * Applies 2D Kalman smoothing and 5-point polygon containment without falsifying raw accuracy.
 */
class NativeLocationService(private val context: Context) {

    companion object {
        private const val TAG = "NativeLocationService"
    }

    private val fusedLocationClient: FusedLocationProviderClient =
        LocationServices.getFusedLocationProviderClient(context)
    private val locationManager: LocationManager? =
        context.getSystemService(Context.LOCATION_SERVICE) as? LocationManager

    private val kalmanFilter = GpsKalmanFilter()
    private var locationCallback: LocationCallback? = null
    private var directGpsListener: LocationListener? = null
    private var isStreaming = false
    private val readingsHistory = mutableListOf<NativeLocationReading>()
    private var bestReading: NativeLocationReading? = null

    /**
     * Checks if fine & coarse location permissions are granted.
     */
    fun hasLocationPermissions(): Boolean {
        val fineGranted = ContextCompat.checkSelfPermission(
            context,
            android.Manifest.permission.ACCESS_FINE_LOCATION
        ) == PackageManager.PERMISSION_GRANTED

        val coarseGranted = ContextCompat.checkSelfPermission(
            context,
            android.Manifest.permission.ACCESS_COARSE_LOCATION
        ) == PackageManager.PERMISSION_GRANTED

        return fineGranted && coarseGranted
    }

    /**
     * Checks if device hardware location / GPS is turned on in Android settings.
     */
    fun isLocationEnabled(): Boolean {
        val mgr = locationManager ?: return false
        return mgr.isProviderEnabled(LocationManager.GPS_PROVIDER) ||
                mgr.isProviderEnabled(LocationManager.NETWORK_PROVIDER)
    }

    /**
     * Intent to open Android Location Settings if GPS is turned off.
     */
    fun getLocationSettingsIntent(): Intent {
        return Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK
        }
    }

    /**
     * Resets acquisition telemetry and Kalman state.
     */
    fun resetSession() {
        stopLocationUpdates()
        kalmanFilter.reset()
        readingsHistory.clear()
        bestReading = null
    }

    /**
     * Requests a single fresh, high-accuracy location fix using getCurrentLocation.
     */
    @SuppressLint("MissingPermission")
    fun requestFreshLocationFix(
        onResult: (NativeLocationReading?, String?) -> Unit
    ) {
        if (!hasLocationPermissions()) {
            onResult(null, "PERMISSION_DENIED")
            return
        }

        if (!isLocationEnabled()) {
            onResult(null, "LOCATION_DISABLED")
            return
        }

        val cancellationTokenSource = CancellationTokenSource()

        fusedLocationClient.getCurrentLocation(
            Priority.PRIORITY_HIGH_ACCURACY,
            cancellationTokenSource.token
        ).addOnSuccessListener { location: Location? ->
            if (location != null) {
                val reading = processRawLocation(location)
                onResult(reading, null)
            } else {
                onResult(null, "LOCATION_UNAVAILABLE")
            }
        }.addOnFailureListener { exception ->
            onResult(null, exception.localizedMessage ?: "LOCATION_ERROR")
        }
    }

    /**
     * Starts continuous high-accuracy location streaming for multi-reading quality & stability checks.
     * Continuously refines accuracy until precision <= 20m and position settles.
     */
    @SuppressLint("MissingPermission")
    fun startLocationStream(
        maxSamples: Int = 30,
        onStateUpdate: (NativeLocationSessionState) -> Unit
    ) {
        if (!hasLocationPermissions()) {
            Log.w(TAG, "Location permissions denied")
            onStateUpdate(
                NativeLocationSessionState(
                    status = "PERMISSION_DENIED",
                    rawAccuracy = null,
                    bestAccuracy = null,
                    readingsCollected = 0,
                    positionStability = "MEASURING",
                    consecutiveGoodCount = 0,
                    isInsideGeofence = null,
                    isAttendanceAllowed = false,
                    currentReading = null,
                    bestReading = null,
                    readingsHistory = emptyList(),
                    errorMessage = "Location permission denied. Please grant Precise Location."
                )
            )
            return
        }

        if (!isLocationEnabled()) {
            Log.w(TAG, "Location hardware is disabled")
            onStateUpdate(
                NativeLocationSessionState(
                    status = "LOCATION_DISABLED",
                    rawAccuracy = null,
                    bestAccuracy = null,
                    readingsCollected = 0,
                    positionStability = "MEASURING",
                    consecutiveGoodCount = 0,
                    isInsideGeofence = null,
                    isAttendanceAllowed = false,
                    currentReading = null,
                    bestReading = null,
                    readingsHistory = emptyList(),
                    errorMessage = "Location is turned off. Please enable device GPS."
                )
            )
            return
        }

        stopLocationUpdates()
        resetSession()
        isStreaming = true
        Log.i(TAG, "Starting dual high-accuracy location stream")

        // 0. Immediate Last Known Location
        try {
            fusedLocationClient.lastLocation.addOnSuccessListener { lastLoc: Location? ->
                if (lastLoc != null && isStreaming && readingsHistory.isEmpty()) {
                    Log.i(TAG, "Last known location fix: ${lastLoc.latitude}, ${lastLoc.longitude}, acc=${lastLoc.accuracy}")
                    handleIncomingLocation(lastLoc, onStateUpdate)
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "LastLocation fetch notice: ${e.message}")
        }

        // 1. High-Accuracy Fused Provider Request (1000ms interval, 500ms min update)
        val locationRequest = LocationRequest.Builder(
            Priority.PRIORITY_HIGH_ACCURACY,
            1000L
        ).apply {
            setMinUpdateIntervalMillis(500L)
            setMaxUpdateDelayMillis(0L)
            setMinUpdateDistanceMeters(0f)
            setWaitForAccurateLocation(true)
        }.build()

        locationCallback = object : LocationCallback() {
            override fun onLocationResult(result: LocationResult) {
                if (!isStreaming) return
                for (loc in result.locations) {
                    handleIncomingLocation(loc, onStateUpdate)
                }
            }
        }

        fusedLocationClient.requestLocationUpdates(
            locationRequest,
            locationCallback!!,
            Looper.getMainLooper()
        )

        // 2. Direct GPS Hardware Radio Listener (forces hardware GNSS chipset power-up for satellite lock)
        try {
            if (locationManager?.isProviderEnabled(LocationManager.GPS_PROVIDER) == true) {
                directGpsListener = object : LocationListener {
                    override fun onLocationChanged(loc: Location) {
                        if (!isStreaming) return
                        handleIncomingLocation(loc, onStateUpdate)
                    }

                    @Deprecated("Deprecated in Java")
                    override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}
                    override fun onProviderEnabled(provider: String) {}
                    override fun onProviderDisabled(provider: String) {}
                }

                locationManager.requestLocationUpdates(
                    LocationManager.GPS_PROVIDER,
                    1000L,
                    0f,
                    directGpsListener!!,
                    Looper.getMainLooper()
                )
            }
        } catch (e: Exception) {
            Log.w(TAG, "GPS_PROVIDER direct registration notice: ${e.message}")
        }

        // Initial acquiring state
        onStateUpdate(
            NativeLocationSessionState(
                status = "ACQUIRING",
                rawAccuracy = null,
                bestAccuracy = null,
                readingsCollected = 0,
                positionStability = "MEASURING",
                consecutiveGoodCount = 0,
                isInsideGeofence = null,
                isAttendanceAllowed = false,
                currentReading = null,
                bestReading = null,
                readingsHistory = emptyList()
            )
        )
    }

    @Synchronized
    private fun handleIncomingLocation(
        loc: Location,
        onStateUpdate: (NativeLocationSessionState) -> Unit
    ) {
        if (!isStreaming) return

        val reading = processRawLocation(loc)
        readingsHistory.add(reading)

        if (bestReading == null || reading.rawAccuracyMeters < bestReading!!.rawAccuracyMeters) {
            bestReading = reading
        }

        val state = evaluateCurrentSessionState()
        Log.d(TAG, "Incoming Fix [${loc.provider}]: lat=${loc.latitude}, lng=${loc.longitude}, acc=±${loc.accuracy}m, best=±${bestReading?.rawAccuracyMeters}m, status=${state.status}")
        onStateUpdate(state)
    }

    /**
     * Stops active location updates from both Fused and direct GPS providers.
     */
    fun stopLocationUpdates() {
        if (locationCallback != null) {
            fusedLocationClient.removeLocationUpdates(locationCallback!!)
            locationCallback = null
        }
        if (directGpsListener != null && locationManager != null) {
            try {
                locationManager.removeUpdates(directGpsListener!!)
            } catch (e: Exception) {
                // Ignore
            }
            directGpsListener = null
        }
        isStreaming = false
        Log.i(TAG, "Location updates stopped")
    }

    private fun processRawLocation(location: Location): NativeLocationReading {
        val kalmanOutput = kalmanFilter.update(
            rawLat = location.latitude,
            rawLng = location.longitude,
            rawAccuracy = location.accuracy,
            timestamp = location.time
        )

        var displacement = 0.0
        if (readingsHistory.isNotEmpty()) {
            val prev = readingsHistory.last()
            displacement = calculateDistanceMeters(
                prev.filteredLatitude, prev.filteredLongitude,
                kalmanOutput.filteredLat, kalmanOutput.filteredLng
            )
        }

        val isInside = GeofenceManager.isPointInPolygon(
            GeofenceManager.LatLng(kalmanOutput.filteredLat, kalmanOutput.filteredLng)
        )

        val quality = GeofenceManager.getGpsQuality(location.accuracy)

        return NativeLocationReading(
            sampleIndex = readingsHistory.size + 1,
            rawLatitude = location.latitude,
            rawLongitude = location.longitude,
            rawAccuracyMeters = location.accuracy,
            filteredLatitude = kalmanOutput.filteredLat,
            filteredLongitude = kalmanOutput.filteredLng,
            timestamp = location.time,
            provider = location.provider ?: "fused",
            quality = quality,
            displacementMeters = displacement,
            isInsidePolygon = isInside,
            kalmanStatus = kalmanOutput.status
        )
    }

    private fun evaluateCurrentSessionState(): NativeLocationSessionState {
        val lastReading = readingsHistory.lastOrNull()
        val best = bestReading ?: lastReading

        if (lastReading == null) {
            return NativeLocationSessionState(
                status = "ACQUIRING",
                rawAccuracy = null,
                bestAccuracy = null,
                readingsCollected = 0,
                positionStability = "MEASURING",
                consecutiveGoodCount = 0,
                isInsideGeofence = null,
                isAttendanceAllowed = false,
                currentReading = null,
                bestReading = null,
                readingsHistory = emptyList()
            )
        }

        // Sliding window stability evaluation
        val totalGood = readingsHistory.count { it.rawAccuracyMeters <= 20f }
        val recentWindow = readingsHistory.takeLast(5)
        val recentGood = recentWindow.count { it.rawAccuracyMeters <= 20f }

        val bestAcc = best?.rawAccuracyMeters ?: lastReading.rawAccuracyMeters
        val isAccurate = (bestAcc <= 20f) || (lastReading.rawAccuracyMeters <= 20f)

        var maxDisp = 0.0
        if (readingsHistory.size >= 2) {
            val slice = readingsHistory.takeLast(minOf(5, readingsHistory.size))
            for (i in 1 until slice.size) {
                val prev = slice[i - 1]
                val curr = slice[i]
                val d = calculateDistanceMeters(
                    prev.filteredLatitude, prev.filteredLongitude,
                    curr.filteredLatitude, curr.filteredLongitude
                )
                if (d > maxDisp) maxDisp = d
            }
        }

        val isStable = maxDisp <= 15.0 && readingsHistory.size >= 2
        val stabilityStatus = if (readingsHistory.size < 2) "MEASURING" else if (isStable) "STABLE" else "UNSTABLE"

        val passesQualityGate = isAccurate && (recentGood >= 1 || totalGood >= 1) && (readingsHistory.size < 2 || isStable)
        val isInsidePolygon = (best ?: lastReading).isInsidePolygon

        val status = when {
            passesQualityGate && isInsidePolygon -> "INSIDE"
            passesQualityGate && !isInsidePolygon -> "OUTSIDE"
            lastReading.rawAccuracyMeters > 50f && (best?.rawAccuracyMeters ?: 100f) > 20f -> "INSUFFICIENT_ACCURACY"
            else -> "ACQUIRING"
        }

        val isAllowed = status == "INSIDE" && passesQualityGate

        return NativeLocationSessionState(
            status = status,
            rawAccuracy = lastReading.rawAccuracyMeters,
            bestAccuracy = best?.rawAccuracyMeters,
            readingsCollected = readingsHistory.size,
            positionStability = stabilityStatus,
            consecutiveGoodCount = totalGood,
            isInsideGeofence = if (passesQualityGate) isInsidePolygon else null,
            isAttendanceAllowed = isAllowed,
            currentReading = lastReading,
            bestReading = best,
            readingsHistory = readingsHistory.toList()
        )
    }

    private fun calculateDistanceMeters(
        lat1: Double, lon1: Double,
        lat2: Double, lon2: Double
    ): Double {
        val r = 6371000.0 // Earth's radius in meters
        val dLat = Math.toRadians(lat2 - lat1)
        val dLon = Math.toRadians(lon2 - lon1)
        val a = sin(dLat / 2) * sin(dLat / 2) +
                cos(Math.toRadians(lat1)) * cos(Math.toRadians(lat2)) *
                sin(dLon / 2) * sin(dLon / 2)
        val c = 2 * atan2(sqrt(a), sqrt(1 - a))
        return r * c
    }
}
