package com.campusattend.biometric.location

import android.content.Context
import android.webkit.JavascriptInterface
import android.webkit.WebView
import org.json.JSONObject

/**
 * JavaScript Interface Bridge connecting native Android Dual GPS / Fused Location
 * directly into the Mark Attendance web application.
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
        context.startActivity(locationService.getLocationSettingsIntent())
    }

    @JavascriptInterface
    fun startLocationUpdates(maxSamples: Int) {
        locationService.startLocationStream(maxSamples) { state ->
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
                }

                state.bestReading?.let { b ->
                    put("bestLatitude", b.rawLatitude)
                    put("bestLongitude", b.rawLongitude)
                    put("bestFilteredLatitude", b.filteredLatitude)
                    put("bestFilteredLongitude", b.filteredLongitude)
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
