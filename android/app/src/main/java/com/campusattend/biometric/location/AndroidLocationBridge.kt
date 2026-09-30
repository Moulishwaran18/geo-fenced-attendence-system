package com.campusattend.biometric.location

import android.content.Context
import android.webkit.JavascriptInterface
import android.webkit.WebView
import org.json.JSONArray
import org.json.JSONObject

/**
 * JavaScript Interface Bridge connecting native Android GNSS, Dual-Frequency,
 * Wi-Fi RTT, and Fused Location directly into the CampusAttend web application.
 */
class AndroidLocationBridge(
    private val context: Context,
    private val locationService: NativeLocationService,
    private val webView: WebView
) {

    @JavascriptInterface
    fun isNative(): Boolean = true

    @JavascriptInterface
    fun isLocationEnabled(): Boolean = locationService.isLocationEnabled()

    @JavascriptInterface
    fun hasPermissions(): Boolean = locationService.hasLocationPermissions()

    @JavascriptInterface
    fun openLocationSettings() {
        try {
            context.startActivity(locationService.getLocationSettingsIntent())
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    @JavascriptInterface
    fun openAppPermissionSettings() {
        try {
            context.startActivity(locationService.getAppPermissionSettingsIntent())
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    @JavascriptInterface
    fun getDeviceCapabilities(): String {
        val caps = locationService.detectDeviceCapabilities()
        return JSONObject().apply {
            put("gnssAvailable", caps.gnssAvailable)
            put("rawGnssAvailable", caps.rawGnssAvailable)
            put("dualFrequencyAvailable", caps.dualFrequencyAvailable)
            put("l1Available", caps.l1Available)
            put("l5Available", caps.l5Available)
            put("carrierPhaseAvailable", caps.carrierPhaseAvailable)
            put("adrAvailable", caps.adrAvailable)
            put("wifiRttAvailable", caps.wifiRttAvailable)
            put("accelerometerAvailable", caps.accelerometerAvailable)
            put("gyroscopeAvailable", caps.gyroscopeAvailable)
        }.toString()
    }

    @JavascriptInterface
    fun startLocationUpdates(maxSamples: Int) {
        val targetSamples = if (maxSamples <= 0) NativeLocationService.MAX_SAMPLES else maxSamples
        locationService.startLocationStream(targetSamples) { state ->
            val json = JSONObject().apply {
                put("source", "NATIVE_FUSED")
                put("status", state.status)
                put("rawAccuracy", state.rawAccuracy)
                put("bestAccuracy", state.bestAccuracy)
                put("readingsCollected", state.readingsCollected)
                put("positionStability", state.positionStability)
                put("consecutiveGoodCount", state.consecutiveGoodCount)
                put("isInsideGeofence", state.isInsideGeofence)
                put("isAttendanceAllowed", state.isAttendanceAllowed)
                put("containmentStatus", state.containmentStatus)
                put("distanceToBoundaryMeters", state.distanceToBoundaryMeters)
                put("filteredLatitude", state.filteredLatitude)
                put("filteredLongitude", state.filteredLongitude)
                put("outliersRejectedCount", state.outliersRejectedCount)
                put("rmsPositionDeviation", state.rmsPositionDeviation)

                // Diagnostic reasons array
                val reasonsArray = JSONArray()
                state.whyAccuracyIsPoor.forEach { reasonsArray.put(it) }
                put("whyAccuracyIsPoor", reasonsArray)

                // Device Capabilities Object
                val caps = state.deviceCapabilities
                put("capabilities", JSONObject().apply {
                    put("gnssAvailable", caps.gnssAvailable)
                    put("rawGnssAvailable", caps.rawGnssAvailable)
                    put("dualFrequencyAvailable", caps.dualFrequencyAvailable)
                    put("l1Available", caps.l1Available)
                    put("l5Available", caps.l5Available)
                    put("carrierPhaseAvailable", caps.carrierPhaseAvailable)
                    put("adrAvailable", caps.adrAvailable)
                    put("wifiRttAvailable", caps.wifiRttAvailable)
                    put("accelerometerAvailable", caps.accelerometerAvailable)
                    put("gyroscopeAvailable", caps.gyroscopeAvailable)
                })

                // GNSS Live Telemetry Object
                val gnss = state.gnssTelemetry
                put("gnss", JSONObject().apply {
                    put("satellitesInView", gnss.satellitesInView)
                    put("satellitesUsedInFix", gnss.satellitesUsedInFix)
                    put("avgCn0DbHz", gnss.avgCn0DbHz)
                    put("topCn0DbHz", gnss.topCn0DbHz)
                    put("rawGnssActive", gnss.rawGnssActive)
                    put("adrState", gnss.adrState)
                    put("multipathDetected", gnss.multipathDetected)
                    put("dualFrequencyActive", gnss.dualFrequencyActive)
                    put("l1Active", gnss.l1Active)
                    put("l5Active", gnss.l5Active)

                    val constArray = JSONArray()
                    gnss.constellations.forEach { constArray.put(it) }
                    put("constellations", constArray)

                    val freqArray = JSONArray()
                    gnss.carrierFrequenciesMHz.forEach { freqArray.put(it) }
                    put("carrierFrequenciesMHz", freqArray)
                })

                // Current Location Reading
                state.currentReading?.let { r ->
                    put("latitude", r.rawLatitude)
                    put("longitude", r.rawLongitude)
                    put("accuracy", r.rawAccuracyMeters)
                    put("filteredLatitude", r.filteredLatitude)
                    put("filteredLongitude", r.filteredLongitude)
                    put("timestamp", r.timestamp)
                    put("provider", r.provider)
                    put("quality", r.quality)
                    put("displacementMeters", r.displacementMeters)
                    put("kalmanStatus", r.kalmanStatus)
                    put("kalmanEstimatedAccuracy", r.kalmanEstimatedAccuracy)
                    put("altitude", r.altitudeMeters)
                    put("verticalAccuracy", r.verticalAccuracyMeters)
                    put("speed", r.speedMps)
                    put("bearing", r.bearingDegrees)
                    put("elapsedRealtimeNanos", r.elapsedRealtimeNanos)
                    put("isOutlierGated", r.isOutlierGated)
                    put("mahalanobisDistance", r.mahalanobisDistance)
                }

                // Best Reading in Window
                state.bestReading?.let { b ->
                    put("bestLatitude", b.rawLatitude)
                    put("bestLongitude", b.rawLongitude)
                    put("bestFilteredLatitude", b.filteredLatitude)
                    put("bestFilteredLongitude", b.filteredLongitude)
                    put("bestAccuracy", b.rawAccuracyMeters)
                }
            }

            webView.post {
                val script = "if (window.__onNativeLocationUpdate) { window.__onNativeLocationUpdate($json); }"
                webView.evaluateJavascript(script, null)
            }
        }
    }

    @JavascriptInterface
    fun stopLocationUpdates() {
        locationService.stopLocationUpdates()
    }
}
