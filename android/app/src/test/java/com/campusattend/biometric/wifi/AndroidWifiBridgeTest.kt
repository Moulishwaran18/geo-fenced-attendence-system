package com.campusattend.biometric.wifi

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AndroidWifiBridgeTest {

    @Test
    fun testRegisteredCampusBssidConstant() {
        assertEquals("B0:1F:8C:29:6B:30", AndroidWifiBridge.REGISTERED_CAMPUS_BSSID)
        assertEquals(
            "Campus Wi-Fi verification failed. Please connect to the official campus Wi-Fi.",
            AndroidWifiBridge.CAMPUS_WIFI_FAILURE_MESSAGE
        )
    }

    @Test
    fun testSanitizeBssidExactMatch() {
        // Create bridge with dummy mock or test static helper
        val raw = "B0:1F:8C:29:6B:30"
        val clean = AndroidWifiBridge.sanitizeBssidStatic(raw)
        assertEquals("B0:1F:8C:29:6B:30", clean)
        assertEquals(AndroidWifiBridge.REGISTERED_CAMPUS_BSSID, clean)
    }

    @Test
    fun testSanitizeBssidLowercaseNormalization() {
        val raw = "b0:1f:8c:29:6b:30"
        val clean = AndroidWifiBridge.sanitizeBssidStatic(raw)
        assertEquals("B0:1F:8C:29:6B:30", clean)
        assertEquals(AndroidWifiBridge.REGISTERED_CAMPUS_BSSID, clean)
    }

    @Test
    fun testSanitizeBssidHyphenDelimiter() {
        val raw = "b0-1f-8c-29-6b-30"
        val clean = AndroidWifiBridge.sanitizeBssidStatic(raw)
        assertEquals("B0:1F:8C:29:6B:30", clean)
    }

    @Test
    fun testSanitizeBssidQuoted() {
        val raw = "\"B0:1F:8C:29:6B:30\""
        val clean = AndroidWifiBridge.sanitizeBssidStatic(raw)
        assertEquals("B0:1F:8C:29:6B:30", clean)
    }

    @Test
    fun testSanitizeBssidRedactedMacRejected() {
        val raw = "02:00:00:00:00:00"
        val clean = AndroidWifiBridge.sanitizeBssidStatic(raw)
        assertEquals("", clean)
    }

    @Test
    fun testSanitizeBssidDefaultZeroMacRejected() {
        val raw = "00:00:00:00:00:00"
        val clean = AndroidWifiBridge.sanitizeBssidStatic(raw)
        assertEquals("", clean)
    }

    @Test
    fun testSanitizeBssidUnavailableStringsRejected() {
        assertEquals("", AndroidWifiBridge.sanitizeBssidStatic("UNKNOWN"))
        assertEquals("", AndroidWifiBridge.sanitizeBssidStatic("<unknown bssid>"))
        assertEquals("", AndroidWifiBridge.sanitizeBssidStatic("BSSID_UNAVAILABLE"))
        assertEquals("", AndroidWifiBridge.sanitizeBssidStatic("NULL"))
        assertEquals("", AndroidWifiBridge.sanitizeBssidStatic(""))
    }
}
