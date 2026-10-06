package com.campusattend.biometric.location

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.hardware.Sensor
import android.hardware.SensorManager
import android.location.GnssMeasurement
import android.location.GnssMeasurementsEvent
import android.location.GnssStatus
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.net.Uri
import android.net.wifi.rtt.WifiRttManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
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

data class DeviceCapabilityReport(
    val gnssAvailable: Boolean,
    val rawGnssAvailable: Boolean,
    val dualFrequencyAvailable: Boolean,
    val l1Available: Boolean,
    val l5Available: Boolean,
    val carrierPhaseAvailable: Boolean,
    val adrAvailable: Boolean,
    val wifiRttAvailable: Boolean,
    val accelerometerAvailable: Boolean,
    val gyroscopeAvailable: Boolean
)

data class GnssLiveTelemetry(
    val satellitesInView: Int = 0,
    val satellitesUsedInFix: Int = 0,
    val constellations: List<String> = emptyList(),
    val carrierFrequenciesMHz: List<Double> = emptyList(),
    val avgCn0DbHz: Float = 0f,
    val topCn0DbHz: Float = 0f,
    val rawGnssActive: Boolean = false,
    val adrState: String = "NOT_AVAILABLE",
    val multipathDetected: Boolean = false,
    val dualFrequencyActive: Boolean = false,
    val l1Active: Boolean = false,
    val l5Active: Boolean = false
)

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
    val kalmanStatus: String,
    val altitudeMeters: Double? = null,
    val verticalAccuracyMeters: Float? = null,
    val speedMps: Float? = null,
    val bearingDegrees: Float? = null,
    val elapsedRealtimeNanos: Long = 0L,
    val kalmanEstimatedAccuracy: Float = rawAccuracyMeters,
    val distanceToBoundaryMeters: Double = 0.0,
    val containmentStatus: String = "UNKNOWN", // INSIDE, OUTSIDE, UNCERTAIN
    val isOutlierGated: Boolean = false,
    val mahalanobisDistance: Double = 0.0
)

data class NativeLocationSessionState(
    val status: String, // IDLE, ACQUIRING, INSIDE, OUTSIDE, UNCERTAIN_BOUNDARY, INSUFFICIENT_ACCURACY, PERMISSION_DENIED, LOCATION_DISABLED
    val rawAccuracy: Float?,
    val bestAccuracy: Float?,
    val readingsCollected: Int,
    val positionStability: String, // STABLE, UNSTABLE, MEASURING
    val consecutiveGoodCount: Int,
    val isInsideGeofence: Boolean?,
    val isAttendanceAllowed: Boolean,
    val currentReading: NativeLocationReading?,
    val bestReading: NativeLocationReading? = null,
    val readingsHistory: List<NativeLocationReading> = emptyList(),
    val deviceCapabilities: DeviceCapabilityReport = DeviceCapabilityReport(
        gnssAvailable = false,
        rawGnssAvailable = false,
        dualFrequencyAvailable = false,
        l1Available = false,
        l5Available = false,
        carrierPhaseAvailable = false,
        adrAvailable = false,
        wifiRttAvailable = false,
        accelerometerAvailable = false,
        gyroscopeAvailable = false
    ),
    val gnssTelemetry: GnssLiveTelemetry = GnssLiveTelemetry(),
    val whyAccuracyIsPoor: List<String> = emptyList(),
    val containmentStatus: String = "UNKNOWN",
    val distanceToBoundaryMeters: Double? = null,
    val filteredLatitude: Double? = null,
    val filteredLongitude: Double? = null,
    val outliersRejectedCount: Int = 0,
    val rmsPositionDeviation: Double = 0.0,
    val errorMessage: String? = null
)

/**
 * Native Android High-Accuracy GNSS & Fused Location Service.
 * Combines Google Play Services FusedLocationProviderClient (PRIORITY_HIGH_ACCURACY)
 * with direct LocationManager GNSS radio access, GnssStatus, and GnssMeasurementsEvent.
 * Applies 2D Kalman smoothing, Chi-Square innovation gating, and boundary uncertainty evaluation.
 */
class NativeLocationService(private val context: Context) {

    companion object {
        private const val TAG = "NativeLocationService"
        const val MIN_SAMPLES = 10
        const val MAX_SAMPLES = 30
    }

    private val fusedLocationClient: FusedLocationProviderClient =
        LocationServices.getFusedLocationProviderClient(context)
    private val locationManager: LocationManager? =
        context.getSystemService(Context.LOCATION_SERVICE) as? LocationManager
    private val sensorManager: SensorManager? =
        context.getSystemService(Context.SENSOR_SERVICE) as? SensorManager
    private val wifiRttManager: WifiRttManager? =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            context.getSystemService(Context.WIFI_RTT_RANGING_SERVICE) as? WifiRttManager
        } else null

    private val kalmanFilter = GpsKalmanFilter()
    private var locationCallback: LocationCallback? = null
    private var directGpsListener: LocationListener? = null
    private var gnssStatusCallback: GnssStatus.Callback? = null
    private var gnssMeasurementsCallback: GnssMeasurementsEvent.Callback? = null

    private var isStreaming = false
    private val readingsHistory = mutableListOf<NativeLocationReading>()
    private var bestReading: NativeLocationReading? = null
    private var outliersRejectedCount = 0

    // Dynamic GNSS Telemetry cache
    @Volatile
    private var currentGnssTelemetry = GnssLiveTelemetry()

    // Hardware capability cache
    private var hasRawGnssHardware = false
    private var hasDualFreqHardware = false
    private var hasL1Hardware = false
    private var hasL5Hardware = false
    private var hasCarrierPhaseHardware = false
    private var hasAdrHardware = false

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
     * Intent to open Application Details / Permissions Settings.
     */
    fun getAppPermissionSettingsIntent(): Intent {
        return Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
            data = Uri.fromParts("package", context.packageName, null)
            flags = Intent.FLAG_ACTIVITY_NEW_TASK
        }
    }

    /**
     * Detects comprehensive device hardware capabilities.
     */
    fun detectDeviceCapabilities(): DeviceCapabilityReport {
        val pm = context.packageManager
        val gnssAvailable = pm.hasSystemFeature(PackageManager.FEATURE_LOCATION_GPS)
        val wifiRttAvailable = (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) &&
                pm.hasSystemFeature(PackageManager.FEATURE_WIFI_RTT) &&
                (wifiRttManager?.isAvailable == true)
        val accelerometerAvailable = sensorManager?.getDefaultSensor(Sensor.TYPE_ACCELEROMETER) != null
        val gyroscopeAvailable = sensorManager?.getDefaultSensor(Sensor.TYPE_GYROSCOPE) != null

        return DeviceCapabilityReport(
            gnssAvailable = gnssAvailable,
            rawGnssAvailable = hasRawGnssHardware || currentGnssTelemetry.rawGnssActive,
            dualFrequencyAvailable = hasDualFreqHardware || currentGnssTelemetry.dualFrequencyActive,
            l1Available = hasL1Hardware || currentGnssTelemetry.l1Active,
            l5Available = hasL5Hardware || currentGnssTelemetry.l5Active,
            carrierPhaseAvailable = hasCarrierPhaseHardware || (currentGnssTelemetry.adrState == "VALID_CARRIER_PHASE"),
            adrAvailable = hasAdrHardware || (currentGnssTelemetry.adrState != "NOT_AVAILABLE"),
            wifiRttAvailable = wifiRttAvailable,
            accelerometerAvailable = accelerometerAvailable,
            gyroscopeAvailable = gyroscopeAvailable
        )
    }

    /**
     * Resets acquisition telemetry and Kalman state.
     */
    fun resetSession() {
        stopLocationUpdates()
        kalmanFilter.reset()
        readingsHistory.clear()
        bestReading = null
        outliersRejectedCount = 0
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
                val validation = validateRawLocation(location)
                if (validation.first) {
                    val reading = processRawLocation(location)
                    onResult(reading, null)
                } else {
                    onResult(null, "OUTLIER_REJECTED: ${validation.second}")
                }
            } else {
                onResult(null, "LOCATION_UNAVAILABLE")
            }
        }.addOnFailureListener { exception ->
            onResult(null, exception.localizedMessage ?: "LOCATION_ERROR")
        }
    }

    /**
     * Starts continuous high-accuracy location streaming with GnssStatus,
     * GnssMeasurementsEvent, and multi-sample acquisition (10 to 30 samples).
     */
    @SuppressLint("MissingPermission")
    fun startLocationStream(
        maxSamples: Int = MAX_SAMPLES,
        onStateUpdate: (NativeLocationSessionState) -> Unit
    ) {
        if (!hasLocationPermissions()) {
            Log.w(TAG, "Location permissions denied")
            onStateUpdate(createErrorState("PERMISSION_DENIED", "Precise Location permission denied. Please allow in settings."))
            return
        }

        if (!isLocationEnabled()) {
            Log.w(TAG, "Location hardware is disabled")
            onStateUpdate(createErrorState("LOCATION_DISABLED", "Location is turned off. Please enable device GPS."))
            return
        }

        stopLocationUpdates()
        resetSession()
        isStreaming = true
        val targetMaxSamples = maxSamples.coerceIn(MIN_SAMPLES, MAX_SAMPLES)
        Log.i(TAG, "Starting high-accuracy GNSS acquisition (target: $targetMaxSamples samples)")

        // 1. Register GNSS Status Callback
        registerGnssStatusCallback()

        // 2. Register Raw GNSS Measurements Callback
        registerGnssMeasurementsCallback()

        // 3. Query Immediate Last Known Location
        try {
            fusedLocationClient.lastLocation.addOnSuccessListener { lastLoc: Location? ->
                if (lastLoc != null && isStreaming && readingsHistory.isEmpty()) {
                    val ageMs = System.currentTimeMillis() - lastLoc.time
                    if (ageMs <= 10000L && validateRawLocation(lastLoc).first) {
                        Log.i(TAG, "Initial fresh fix accepted (age ${ageMs}ms): ±${lastLoc.accuracy}m")
                        handleIncomingLocation(lastLoc, targetMaxSamples, onStateUpdate)
                    }
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "LastLocation fetch notice: ${e.message}")
        }

        // 4. High-Accuracy Fused Provider Request (1000ms interval, 500ms min update)
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
                    handleIncomingLocation(loc, targetMaxSamples, onStateUpdate)
                }
            }
        }

        fusedLocationClient.requestLocationUpdates(
            locationRequest,
            locationCallback!!,
            Looper.getMainLooper()
        )

        // 5. Direct GPS Hardware Radio Listener
        try {
            if (locationManager?.isProviderEnabled(LocationManager.GPS_PROVIDER) == true) {
                directGpsListener = object : LocationListener {
                    override fun onLocationChanged(loc: Location) {
                        if (!isStreaming) return
                        handleIncomingLocation(loc, targetMaxSamples, onStateUpdate)
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
                readingsHistory = emptyList(),
                deviceCapabilities = detectDeviceCapabilities(),
                gnssTelemetry = currentGnssTelemetry,
                whyAccuracyIsPoor = listOf("Initializing GNSS receivers and satellite locks..."),
                containmentStatus = "UNKNOWN"
            )
        )
    }

    @SuppressLint("MissingPermission")
    private fun registerGnssStatusCallback() {
        if (locationManager == null || !hasLocationPermissions()) return
        try {
            gnssStatusCallback = object : GnssStatus.Callback() {
                override fun onSatelliteStatusChanged(status: GnssStatus) {
                    val count = status.satelliteCount
                    var usedCount = 0
                    var sumCn0 = 0f
                    var maxCn0 = 0f
                    val constellations = mutableSetOf<String>()
                    val frequencies = mutableListOf<Double>()
                    var hasL1 = false
                    var hasL5 = false

                    for (i in 0 until count) {
                        val cn0 = status.getCn0DbHz(i)
                        sumCn0 += cn0
                        if (cn0 > maxCn0) maxCn0 = cn0

                        if (status.usedInFix(i)) {
                            usedCount++
                        }

                        val constType = when (status.getConstellationType(i)) {
                            GnssStatus.CONSTELLATION_GPS -> "GPS"
                            GnssStatus.CONSTELLATION_GLONASS -> "GLONASS"
                            GnssStatus.CONSTELLATION_GALILEO -> "GALILEO"
                            GnssStatus.CONSTELLATION_BEIDOU -> "BEIDOU"
                            GnssStatus.CONSTELLATION_QZSS -> "QZSS"
                            GnssStatus.CONSTELLATION_IRNSS -> "NavIC"
                            else -> "SBAS"
                        }
                        constellations.add(constType)

                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && status.hasCarrierFrequencyHz(i)) {
                            val freqHz = status.getCarrierFrequencyHz(i)
                            val freqMHz = freqHz / 1_000_000.0
                            frequencies.add(freqMHz)

                            // Detect L1 (1575.42 MHz) and L5 (1176.45 MHz / E5a / B2a)
                            if (freqMHz in 1550.0..1610.0) {
                                hasL1 = true
                                hasL1Hardware = true
                            }
                            if (freqMHz in 1160.0..1215.0) {
                                hasL5 = true
                                hasL5Hardware = true
                                hasDualFreqHardware = true
                            }
                        }
                    }

                    val avgCn0 = if (count > 0) sumCn0 / count else 0f
                    val isDual = hasL1 && hasL5

                    currentGnssTelemetry = currentGnssTelemetry.copy(
                        satellitesInView = count,
                        satellitesUsedInFix = usedCount,
                        constellations = constellations.toList(),
                        carrierFrequenciesMHz = frequencies.distinct(),
                        avgCn0DbHz = avgCn0,
                        topCn0DbHz = maxCn0,
                        dualFrequencyActive = isDual,
                        l1Active = hasL1,
                        l5Active = hasL5
                    )
                }
            }

            locationManager.registerGnssStatusCallback(gnssStatusCallback!!, Handler(Looper.getMainLooper()))
            Log.i(TAG, "GnssStatus callback registered successfully")
        } catch (e: Exception) {
            Log.w(TAG, "GnssStatus registration warning: ${e.message}")
        }
    }

    @SuppressLint("MissingPermission")
    private fun registerGnssMeasurementsCallback() {
        if (locationManager == null || !hasLocationPermissions()) return
        try {
            gnssMeasurementsCallback = object : GnssMeasurementsEvent.Callback() {
                override fun onGnssMeasurementsReceived(event: GnssMeasurementsEvent) {
                    hasRawGnssHardware = true
                    val measurements = event.measurements
                    if (measurements.isEmpty()) return

                    var adrValidCount = 0
                    var cycleSlipCount = 0
                    var multipathCount = 0
                    var hasL1 = false
                    var hasL5 = false

                    for (m in measurements) {
                        val adrState = m.accumulatedDeltaRangeState
                        if ((adrState and GnssMeasurement.ADR_STATE_VALID) != 0) {
                            adrValidCount++
                            hasAdrHardware = true
                            hasCarrierPhaseHardware = true
                        }
                        if ((adrState and GnssMeasurement.ADR_STATE_CYCLE_SLIP) != 0) {
                            cycleSlipCount++
                        }
                        if (m.multipathIndicator == GnssMeasurement.MULTIPATH_INDICATOR_DETECTED) {
                            multipathCount++
                        }

                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && m.hasCarrierFrequencyHz()) {
                            val mhz = m.carrierFrequencyHz / 1_000_000.0
                            if (mhz in 1550.0..1610.0) hasL1 = true
                            if (mhz in 1160.0..1215.0) {
                                hasL5 = true
                                hasDualFreqHardware = true
                            }
                        }
                    }

                    val adrDesc = when {
                        adrValidCount >= 4 -> "VALID_CARRIER_PHASE"
                        adrValidCount > 0 -> "PARTIAL_ADR ($adrValidCount locked)"
                        cycleSlipCount > 0 -> "CYCLE_SLIPS_DETECTED"
                        else -> "CODE_TRACKING_ONLY"
                    }

                    currentGnssTelemetry = currentGnssTelemetry.copy(
                        rawGnssActive = true,
                        adrState = adrDesc,
                        multipathDetected = multipathCount > 0,
                        dualFrequencyActive = hasL1 && hasL5,
                        l1Active = hasL1 || currentGnssTelemetry.l1Active,
                        l5Active = hasL5 || currentGnssTelemetry.l5Active
                    )
                }
            }

            locationManager.registerGnssMeasurementsCallback(gnssMeasurementsCallback!!, Handler(Looper.getMainLooper()))
            Log.i(TAG, "GnssMeasurementsEvent callback registered successfully")
        } catch (e: Exception) {
            Log.w(TAG, "GnssMeasurementsEvent registration notice: ${e.message}")
        }
    }

    /**
     * Validates raw incoming location fixes to reject impossible jumps,
     * stale data, NaN coordinates, and regional anomalies.
     */
    private fun validateRawLocation(loc: Location): Pair<Boolean, String?> {
        if (loc.latitude.isNaN() || loc.longitude.isNaN()) {
            return Pair(false, "NaN coordinates")
        }
        if (loc.latitude < -90.0 || loc.latitude > 90.0 || loc.longitude < -180.0 || loc.longitude > 180.0) {
            return Pair(false, "Coordinates out of geographic range")
        }
        if (loc.latitude == 0.0 && loc.longitude == 0.0) {
            return Pair(false, "Null Island (0,0)")
        }

        // Regional Sanity Bounds for Institutional Campus (Salem, Tamil Nadu envelope: Lat 8.0 to 14.5, Lng 76.0 to 81.0)
        if (loc.latitude < 8.0 || loc.latitude > 14.5 || loc.longitude < 76.0 || loc.longitude > 81.0) {
            return Pair(false, "Coordinate outside regional envelope (${loc.latitude}, ${loc.longitude})")
        }

        // Stale timestamp check (reject if older than 15s)
        val ageMs = System.currentTimeMillis() - loc.time
        if (ageMs > 15000L || ageMs < -5000L) {
            return Pair(false, "Stale location fix (age: ${ageMs}ms)")
        }

        // Sudden impossible jump check relative to last valid reading
        if (readingsHistory.isNotEmpty()) {
            val last = readingsHistory.last()
            val dtSec = (loc.time - last.timestamp) / 1000.0
            val dist = calculateDistanceMeters(last.rawLatitude, last.rawLongitude, loc.latitude, loc.longitude)
            if (dtSec > 0.1 && (dist / dtSec) > 25.0 && loc.accuracy > 20f) {
                return Pair(false, "Sudden GPS jump ($dist m in $dtSec s, velocity ${(dist / dtSec).toInt()} m/s)")
            }
        }

        return Pair(true, null)
    }

    @Synchronized
    private fun handleIncomingLocation(
        loc: Location,
        targetMaxSamples: Int,
        onStateUpdate: (NativeLocationSessionState) -> Unit
    ) {
        if (!isStreaming) return

        // Outlier Validation
        val validation = validateRawLocation(loc)
        if (!validation.first) {
            outliersRejectedCount++
            Log.w(TAG, "Outlier rejected (#$outliersRejectedCount): ${validation.second}")
            return
        }

        val reading = processRawLocation(loc)
        readingsHistory.add(reading)

        if (bestReading == null || reading.rawAccuracyMeters < bestReading!!.rawAccuracyMeters) {
            bestReading = reading
        }

        val state = evaluateCurrentSessionState()
        Log.d(TAG, "Incoming GNSS Fix [${loc.provider}]: lat=${loc.latitude}, lng=${loc.longitude}, acc=±${loc.accuracy}m, best=±${bestReading?.rawAccuracyMeters}m, status=${state.status}")
        onStateUpdate(state)

        // Stop updates if quality/stability gate passes and we have collected enough samples, or if reached max
        if (readingsHistory.size >= targetMaxSamples || (state.isAttendanceAllowed && readingsHistory.size >= MIN_SAMPLES)) {
            Log.i(TAG, "Acquisition target satisfied (readings=${readingsHistory.size}, status=${state.status}). Stopping listeners.")
            stopLocationUpdates()
        }
    }

    /**
     * Stops active location updates from Fused, GPS provider, GnssStatus, and GnssMeasurements.
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
        if (gnssStatusCallback != null && locationManager != null) {
            try {
                locationManager.unregisterGnssStatusCallback(gnssStatusCallback!!)
            } catch (e: Exception) {
                // Ignore
            }
            gnssStatusCallback = null
        }
        if (gnssMeasurementsCallback != null && locationManager != null) {
            try {
                locationManager.unregisterGnssMeasurementsCallback(gnssMeasurementsCallback!!)
            } catch (e: Exception) {
                // Ignore
            }
            gnssMeasurementsCallback = null
        }
        isStreaming = false
        Log.i(TAG, "All GNSS location listeners stopped")
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

        // Authoritative containment with boundary uncertainty
        val containment = GeofenceManager.evaluateContainment(
            GeofenceManager.LatLng(kalmanOutput.filteredLat, kalmanOutput.filteredLng),
            location.accuracy
        )

        val isInside = containment.first == GeofenceManager.GeofenceContainmentStatus.INSIDE
        val quality = GeofenceManager.getGpsQuality(location.accuracy)

        val alt = if (location.hasAltitude()) location.altitude else null
        val vertAcc = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && location.hasVerticalAccuracy()) {
            location.verticalAccuracyMeters
        } else null
        val spd = if (location.hasSpeed()) location.speed else null
        val brg = if (location.hasBearing()) location.bearing else null
        val elapsed = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.JELLY_BEAN_MR1) {
            location.elapsedRealtimeNanos
        } else SystemClock.elapsedRealtime() * 1_000_000L

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
            kalmanStatus = kalmanOutput.status,
            altitudeMeters = alt,
            verticalAccuracyMeters = vertAcc,
            speedMps = spd,
            bearingDegrees = brg,
            elapsedRealtimeNanos = elapsed,
            kalmanEstimatedAccuracy = kalmanOutput.kalmanEstimatedAccuracy,
            distanceToBoundaryMeters = containment.second,
            containmentStatus = containment.first.name,
            isOutlierGated = kalmanOutput.isOutlierGated,
            mahalanobisDistance = kalmanOutput.mahalanobisDistance
        )
    }

    private fun evaluateCurrentSessionState(): NativeLocationSessionState {
        val lastReading = readingsHistory.lastOrNull()
        val best = bestReading ?: lastReading
        val caps = detectDeviceCapabilities()
        val gnss = currentGnssTelemetry

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
                readingsHistory = emptyList(),
                deviceCapabilities = caps,
                gnssTelemetry = gnss
            )
        }

        // Sliding window stability evaluation on RECENT readings (last 5)
        val recentWindow = readingsHistory.takeLast(5)
        val recentGood = recentWindow.count { it.rawAccuracyMeters <= 20f }
        val totalGood = readingsHistory.count { it.rawAccuracyMeters <= 20f }

        // Require the recent fix to be accurate (do NOT rely solely on ancient bestReading)
        val isAccurate = lastReading.rawAccuracyMeters <= 20f || (recentGood >= 3 && (best?.rawAccuracyMeters ?: 999f) <= 20f)

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

        // Calculate RMS position deviation
        var sumDev2 = 0.0
        val centerLat = readingsHistory.map { it.filteredLatitude }.average()
        val centerLng = readingsHistory.map { it.filteredLongitude }.average()
        for (r in readingsHistory) {
            val dist = calculateDistanceMeters(centerLat, centerLng, r.filteredLatitude, r.filteredLongitude)
            sumDev2 += dist * dist
        }
        val rmsDev = sqrt(sumDev2 / readingsHistory.size.coerceAtLeast(1))

        // Diagnostic reasoning: Why accuracy is poor
        val reasons = mutableListOf<String>()
        if (lastReading.rawAccuracyMeters > 20f) {
            if (gnss.satellitesUsedInFix in 1..3) {
                reasons.add("Insufficient satellites locked (<4) for 3D trilateration")
            }
            if (gnss.avgCn0DbHz > 0f && gnss.avgCn0DbHz < 28f) {
                reasons.add("Weak satellite signals (avg C/N0 < 28 dB-Hz) due to indoor or building attenuation")
            }
            if (gnss.multipathDetected) {
                reasons.add("Multipath signal reflection detected from surrounding structures")
            }
            if (!caps.dualFrequencyAvailable) {
                reasons.add("Single-frequency GNSS receiver subject to ionospheric delay")
            }
            if (lastReading.provider == "network") {
                reasons.add("Cell-tower / Wi-Fi network triangulation active instead of GNSS satellite lock")
            }
            if (reasons.isEmpty()) {
                reasons.add("Indoor environment / obstructed line-of-sight to GNSS constellation")
            }
        }

        val passesQualityGate = isAccurate && (recentGood >= 2 || totalGood >= 2) && isStable
        val containment = lastReading.containmentStatus
        val isInsidePolygon = lastReading.isInsidePolygon

        val status = when {
            containment == "UNCERTAIN" && passesQualityGate -> "UNCERTAIN_BOUNDARY"
            passesQualityGate && isInsidePolygon -> "INSIDE"
            passesQualityGate && !isInsidePolygon -> "OUTSIDE"
            lastReading.rawAccuracyMeters > 50f && (best?.rawAccuracyMeters ?: 100f) > 20f -> "INSUFFICIENT_ACCURACY"
            else -> "ACQUIRING"
        }

        // Attendance allowed ONLY when strictly INSIDE (not uncertain, not outside) and quality gate passes
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
            readingsHistory = readingsHistory.toList(),
            deviceCapabilities = caps,
            gnssTelemetry = gnss,
            whyAccuracyIsPoor = reasons,
            containmentStatus = containment,
            distanceToBoundaryMeters = lastReading.distanceToBoundaryMeters,
            filteredLatitude = lastReading.filteredLatitude,
            filteredLongitude = lastReading.filteredLongitude,
            outliersRejectedCount = outliersRejectedCount,
            rmsPositionDeviation = rmsDev
        )
    }

    private fun createErrorState(status: String, message: String): NativeLocationSessionState {
        return NativeLocationSessionState(
            status = status,
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
            deviceCapabilities = detectDeviceCapabilities(),
            gnssTelemetry = currentGnssTelemetry,
            whyAccuracyIsPoor = listOf(message),
            errorMessage = message
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
