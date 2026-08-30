package com.campusattend.biometric.location

import kotlin.math.cos
import kotlin.math.sqrt

/**
 * 2D Constant-Velocity Kalman Filter for GPS Position Smoothing in Native Android.
 * Converts WGS-84 to local tangent-plane East/North meters, predicts state,
 * applies dynamic measurement covariance R derived from raw accuracy, and smooths position.
 */
class GpsKalmanFilter(
    private val originLat: Double = 11.68030640,
    private val originLng: Double = 78.12182360,
    private val processNoiseAcc: Double = 0.5
) {
    companion object {
        private const val EARTH_RADIUS = 6371000.0
    }

    private var x = 0.0
    private var y = 0.0
    private var vx = 0.0
    private var vy = 0.0

    private var p00 = 100.0
    private var p01 = 0.0
    private var p02 = 0.0
    private var p03 = 0.0

    private var p10 = 0.0
    private var p11 = 100.0
    private var p12 = 0.0
    private var p13 = 0.0

    private var p20 = 10.0
    private var p21 = 0.0
    private var p22 = 10.0
    private var p23 = 0.0

    private var p30 = 0.0
    private var p31 = 10.0
    private var p32 = 0.0
    private var p33 = 10.0

    private var lastTimestamp: Long? = null
    var sampleCount: Int = 0
        private set

    fun reset() {
        x = 0.0
        y = 0.0
        vx = 0.0
        vy = 0.0
        p00 = 100.0; p01 = 0.0; p02 = 0.0; p03 = 0.0
        p10 = 0.0; p11 = 100.0; p12 = 0.0; p13 = 0.0
        p20 = 10.0; p21 = 0.0; p22 = 10.0; p23 = 0.0
        p30 = 0.0; p31 = 10.0; p32 = 0.0; p33 = 10.0
        lastTimestamp = null
        sampleCount = 0
    }

    data class FilteredResult(
        val rawLat: Double,
        val rawLng: Double,
        val rawAccuracy: Float,
        val filteredLat: Double,
        val filteredLng: Double,
        val estimatedSpeedMps: Double,
        val sampleCount: Int,
        val status: String
    )

    fun update(rawLat: Double, rawLng: Double, rawAccuracy: Float, timestamp: Long): FilteredResult {
        val latFactor = (Math.PI / 180.0) * EARTH_RADIUS
        val lngFactor = (Math.PI / 180.0) * EARTH_RADIUS * cos(originLat * Math.PI / 180.0)

        val measX = (rawLng - originLng) * lngFactor
        val measY = (rawLat - originLat) * latFactor

        if (sampleCount == 0 || lastTimestamp == null) {
            x = measX
            y = measY
            vx = 0.0
            vy = 0.0
            val varPos = (rawAccuracy * rawAccuracy).toDouble().coerceAtLeast(4.0)
            p00 = varPos; p11 = varPos; p22 = 4.0; p33 = 4.0
            lastTimestamp = timestamp
            sampleCount = 1
            return FilteredResult(
                rawLat, rawLng, rawAccuracy, rawLat, rawLng, 0.0, 1, "INITIALIZING"
            )
        }

        var dt = ((timestamp - lastTimestamp!!) / 1000.0).coerceIn(0.05, 10.0)
        lastTimestamp = timestamp
        sampleCount++

        // Predict step
        val xPred = x + vx * dt
        val yPred = y + vy * dt
        val vxPred = vx
        val vyPred = vy

        val q = processNoiseAcc
        val dt2 = dt * dt
        val dt3 = dt2 * dt
        val q00 = q * (dt3 / 3.0)
        val q02 = q * (dt2 / 2.0)
        val q11 = q * (dt3 / 3.0)
        val q13 = q * (dt2 / 2.0)
        val q22 = q * dt
        val q33 = q * dt

        val pPred00 = p00 + dt * (p20 + p02) + dt2 * p22 + q00
        val pPred01 = p01 + dt * (p21 + p03) + dt2 * p23
        val pPred10 = p10 + dt * (p30 + p12) + dt2 * p32
        val pPred11 = p11 + dt * (p31 + p13) + dt2 * p33 + q11

        val pPred20 = p20 + dt * p22 + q02
        val pPred21 = p21 + dt * p23
        val pPred30 = p30 + dt * p32
        val pPred31 = p31 + dt * p33 + q13

        val pPred22 = p22 + q22
        val pPred33 = p33 + q33

        // Measurement noise
        val sigma = rawAccuracy.toDouble().coerceAtLeast(1.0)
        val varMeas = sigma * sigma

        val s00 = pPred00 + varMeas
        val s11 = pPred11 + varMeas
        val detS = s00 * s11 - pPred01 * pPred10
        val invDetS = if (detS != 0.0) 1.0 / detS else 1e-6

        val invS00 = s11 * invDetS
        val invS01 = -pPred01 * invDetS
        val invS10 = -pPred10 * invDetS
        val invS11 = s00 * invDetS

        // Kalman Gain
        val k00 = pPred00 * invS00 + pPred01 * invS10
        val k01 = pPred00 * invS01 + pPred01 * invS11
        val k10 = pPred10 * invS00 + pPred11 * invS10
        val k11 = pPred10 * invS01 + pPred11 * invS11
        val k20 = pPred20 * invS00 + pPred21 * invS10
        val k21 = pPred20 * invS01 + pPred21 * invS11
        val k30 = pPred30 * invS00 + pPred31 * invS10
        val k31 = pPred30 * invS01 + pPred31 * invS11

        // Innovation
        val y0 = measX - xPred
        val y1 = measY - yPred

        // State update
        x = xPred + (k00 * y0 + k01 * y1)
        y = yPred + (k10 * y0 + k11 * y1)
        vx = vxPred + (k20 * y0 + k21 * y1)
        vy = vyPred + (k30 * y0 + k31 * y1)

        // Covariance update
        p00 = (1.0 - k00) * pPred00 - k01 * pPred10
        p11 = -k10 * pPred01 + (1.0 - k11) * pPred11
        p22 = pPred22
        p33 = pPred33

        val filteredLat = originLat + y / latFactor
        val filteredLng = originLng + x / lngFactor
        val speed = sqrt(vx * vx + vy * vy)
        val status = if (sampleCount < 2) "INITIALIZING" else if (sampleCount >= 4) "SETTLED" else "ACTIVE"

        return FilteredResult(
            rawLat = rawLat,
            rawLng = rawLng,
            rawAccuracy = rawAccuracy,
            filteredLat = filteredLat,
            filteredLng = filteredLng,
            estimatedSpeedMps = speed,
            sampleCount = sampleCount,
            status = status
        )
    }
}
