package com.campusattend.biometric.wifi

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AndroidWifiBridgeTest {

    @Test
    fun testRegisteredCampusBssidConstant() {
        assertEquals("B0:1F:8C:29:6B:30", AndroidWifiBridge.REGISTERED_CAMPUS_BSSID)
        assertEquals("72:CD:0D:E8:D4:B0", AndroidWifiBridge.SECONDARY_APPROVED_BSSID)
        assertTrue(AndroidWifiBridge.APPROVED_CAMPUS_BSSIDS.contains("B0:1F:8C:29:6B:30"))
        assertTrue(AndroidWifiBridge.APPROVED_CAMPUS_BSSIDS.contains("72:CD:0D:E8:D4:B0"))
        assertEquals(2, AndroidWifiBridge.APPROVED_CAMPUS_BSSIDS.size)
        assertEquals(
            "Campus Wi-Fi verification failed. Please connect to the official campus Wi-Fi.",
            AndroidWifiBridge.CAMPUS_WIFI_FAILURE_MESSAGE
        )
    }

    @Test
    fun testIsAuthorizedBssidAllowlist() {
        // Campus Wi-Fi AP
        assertTrue(AndroidWifiBridge.isAuthorizedBssid("B0:1F:8C:29:6B:30"))
        assertTrue(AndroidWifiBridge.isAuthorizedBssid("b0:1f:8c:29:6b:30"))
        assertTrue(AndroidWifiBridge.isAuthorizedBssid("B0-1F-8C-29-6B-30"))

        // Secondary Approved Hotspot AP
        assertTrue(AndroidWifiBridge.isAuthorizedBssid("72:CD:0D:E8:D4:B0"))
        assertTrue(AndroidWifiBridge.isAuthorizedBssid("72:cd:0d:e8:d4:b0"))
        assertTrue(AndroidWifiBridge.isAuthorizedBssid("72-cd-0d-e8-d4-b0"))
        assertTrue(AndroidWifiBridge.isAuthorizedBssid("\"72:CD:0D:E8:D4:B0\""))

        // Unapproved APs
        assertFalse(AndroidWifiBridge.isAuthorizedBssid("00:11:22:33:44:55"))
        assertFalse(AndroidWifiBridge.isAuthorizedBssid("AA:BB:CC:DD:EE:FF"))

        // Dummy, redacted, and invalid
        assertFalse(AndroidWifiBridge.isAuthorizedBssid("02:00:00:00:00:00"))
        assertFalse(AndroidWifiBridge.isAuthorizedBssid("00:00:00:00:00:00"))
        assertFalse(AndroidWifiBridge.isAuthorizedBssid("UNKNOWN"))
        assertFalse(AndroidWifiBridge.isAuthorizedBssid("<unknown bssid>"))
        assertFalse(AndroidWifiBridge.isAuthorizedBssid("BSSID_UNAVAILABLE"))
        assertFalse(AndroidWifiBridge.isAuthorizedBssid(null))
        assertFalse(AndroidWifiBridge.isAuthorizedBssid(""))
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
