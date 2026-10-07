package com.campusattend.biometric.wifi

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.location.LocationManager
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.wifi.WifiInfo
import android.net.wifi.WifiManager
import android.os.Build
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.core.content.ContextCompat
import androidx.core.location.LocationManagerCompat
import com.campusattend.biometric.MainActivity
import android.text.format.Formatter
import org.json.JSONArray
import org.json.JSONObject
import java.net.Inet4Address
import java.net.Inet6Address

/**
 * Native Android Wi-Fi Bridge
 *
 * Exposes real device connected Wi-Fi SSID and transport status to the web application:
 * - Direct SSID extraction via ConnectivityManager & WifiManager
 * - Proper Android permission checks (ACCESS_FINE_LOCATION / NEARBY_WIFI_DEVICES)
 * - Location services state verification (required by Android for SSID disclosure)
 * - Cellular vs Wi-Fi distinction (blocks mobile data from masquerading as Wi-Fi)
 */
class AndroidWifiBridge(
    private val context: Context,
    private val webView: WebView?
) {
    private val wifiManager =
        context.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
    private val connectivityManager =
        context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
    private val locationManager =
        context.getSystemService(Context.LOCATION_SERVICE) as? LocationManager

    @JavascriptInterface
    fun isAvailable(): Boolean = true

    /**
     * Origin verification to ensure only the trusted Vercel application
     * or authorized local development hosts can invoke native Wi-Fi methods.
     */
    private fun isCallingOriginTrusted(): Boolean {
        val currentUrl = webView?.url ?: return true
        val trustedHosts = listOf(
            "geo-fenced-attendence-system.vercel.app",
            "localhost",
            "127.0.0.1",
            "10.0.2.2"
        )
        return try {
            val uri = android.net.Uri.parse(currentUrl)
            val host = uri.host?.lowercase() ?: ""
            trustedHosts.any { host == it || host.endsWith(".$it") }
        } catch (_: Exception) {
            false
        }
    }

    /**
     * Checks if the required runtime permissions to obtain the Wi-Fi SSID are granted.
     * Android requires ACCESS_FINE_LOCATION (or ACCESS_COARSE_LOCATION) to query the connected SSID.
     */
    private fun hasWifiPermissions(): Boolean {
        val fineGranted = ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.ACCESS_FINE_LOCATION
        ) == PackageManager.PERMISSION_GRANTED

        val coarseGranted = ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.ACCESS_COARSE_LOCATION
        ) == PackageManager.PERMISSION_GRANTED

        return fineGranted || coarseGranted
    }

    /**
     * Checks if device-level location services are turned ON.
     * Android requires location services to be enabled for apps to read the connected Wi-Fi SSID.
     */
    private fun isLocationServiceEnabled(): Boolean {
        return if (locationManager != null) {
            LocationManagerCompat.isLocationEnabled(locationManager)
        } else {
            true
        }
    }

    /**
     * Requests the required permissions via the native Android Activity.
     */
    @JavascriptInterface
    fun requestWifiPermissions(): Boolean {
        val activity = context as? MainActivity
        activity?.requestWifiPermissionsFromBridge()
        return true
    }

    @Suppress("DEPRECATION")
    private fun formatIp(ipInt: Int): String {
        return if (ipInt == 0) "" else Formatter.formatIpAddress(ipInt)
    }

    private fun calculateSubnet(addr: Inet4Address, prefixLength: Int): String {
        return try {
            val bytes = addr.address
            val ipInt = ((bytes[0].toInt() and 0xFF) shl 24) or
                    ((bytes[1].toInt() and 0xFF) shl 16) or
                    ((bytes[2].toInt() and 0xFF) shl 8) or
                    (bytes[3].toInt() and 0xFF)
            val mask = if (prefixLength == 0) 0 else (-1 shl (32 - prefixLength))
            val subnetInt = ipInt and mask
            val b1 = (subnetInt ushr 24) and 0xFF
            val b2 = (subnetInt ushr 16) and 0xFF
            val b3 = (subnetInt ushr 8) and 0xFF
            val b4 = subnetInt and 0xFF
            "$b1.$b2.$b3.$b4/$prefixLength"
        } catch (_: Exception) {
            ""
        }
    }

    /**
     * Obtains the connected network-level fingerprint:
     * - Transport (wifi, cellular, none)
     * - Client IPv4 address
     * - IPv4 CIDR subnet (calculated from address + prefix length)
     * - Prefix length
     * - Default gateway (from active routing table or DHCP)
     * - DNS servers (from LinkProperties or DHCP)
     * - Internet & VPN capabilities
     *
     * DOES NOT REQUIRE OR USE:
     * - SSID / Wi-Fi name
     * - BSSID
     * - MAC address
     * - Location permissions
     */
    @JavascriptInterface
    fun getNetworkFingerprint(): String {
        val json = JSONObject()
        if (!isCallingOriginTrusted()) {
            json.put("transport", "unknown")
            json.put("isWifi", false)
            json.put("reason", "UNTRUSTED_ORIGIN")
            return json.toString()
        }

        try {
            val activeNetwork = connectivityManager?.activeNetwork
            val caps = connectivityManager?.getNetworkCapabilities(activeNetwork)
            val linkProps = connectivityManager?.getLinkProperties(activeNetwork)

            val isWifi = caps?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true
            val isCellular = caps?.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) == true
            val hasInternet = caps?.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) == true
            val notVpn = caps?.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_VPN) ?: true

            val transport = when {
                isWifi -> "wifi"
                isCellular -> "cellular"
                activeNetwork != null -> "other"
                else -> "none"
            }

            json.put("transport", transport)
            json.put("isWifi", isWifi)
            json.put("hasInternet", hasInternet)
            json.put("notVpn", notVpn)

            if (!isWifi) {
                json.put("ipv4", JSONObject.NULL)
                json.put("ipv4Subnet", JSONObject.NULL)
                json.put("prefixLength", 0)
                json.put("gateway", JSONObject.NULL)
                json.put("dnsServers", JSONArray())
                json.put("reason", if (isCellular) "CELLULAR_DATA" else "NOT_WIFI")
                return json.toString()
            }

            // Extract IPv4 & Subnet from LinkProperties
            var ipv4 = ""
            var prefixLength = 0
            var ipv4Subnet = ""
            linkProps?.linkAddresses?.forEach { addr ->
                val inetAddr = addr.address
                if (inetAddr is Inet4Address && ipv4.isEmpty()) {
                    ipv4 = inetAddr.hostAddress ?: ""
                    prefixLength = addr.prefixLength
                    ipv4Subnet = calculateSubnet(inetAddr, prefixLength)
                }
            }

            // Extract Gateway from Routes or DHCP
            var gateway = ""
            linkProps?.routes?.forEach { route ->
                if (route.isDefaultRoute || route.hasGateway()) {
                    val gw = route.gateway
                    if (gw is Inet4Address && gateway.isEmpty()) {
                        gateway = gw.hostAddress ?: ""
                    }
                }
            }
            if (gateway.isEmpty() && wifiManager != null) {
                @Suppress("DEPRECATION")
                val dhcp = wifiManager.dhcpInfo
                if (dhcp != null && dhcp.gateway != 0) {
                    gateway = formatIp(dhcp.gateway)
                }
            }

            // Extract DNS servers from LinkProperties or DHCP
            val dnsServers = JSONArray()
            linkProps?.dnsServers?.forEach { dns ->
                val host = dns.hostAddress
                if (!host.isNullOrBlank()) {
                    dnsServers.put(host)
                }
            }
            if (dnsServers.length() == 0 && wifiManager != null) {
                @Suppress("DEPRECATION")
                val dhcp = wifiManager.dhcpInfo
                if (dhcp != null) {
                    val d1 = formatIp(dhcp.dns1)
                    val d2 = formatIp(dhcp.dns2)
                    if (d1.isNotEmpty()) dnsServers.put(d1)
                    if (d2.isNotEmpty()) dnsServers.put(d2)
                }
            }

            json.put("ipv4", if (ipv4.isNotEmpty()) ipv4 else JSONObject.NULL)
            json.put("ipv4Subnet", if (ipv4Subnet.isNotEmpty()) ipv4Subnet else JSONObject.NULL)
            json.put("prefixLength", prefixLength)
            json.put("gateway", if (gateway.isNotEmpty()) gateway else JSONObject.NULL)
            json.put("dnsServers", dnsServers)
            json.put("reason", "SUCCESS")

        } catch (e: Exception) {
            json.put("transport", "unknown")
            json.put("isWifi", false)
            json.put("reason", e.message ?: "FINGERPRINT_EXTRACTION_FAILED")
        }

        return json.toString()
    }

    /**
     * Direct string query method for SSID retrieval.
     * Concept: window.AndroidWifiBridge.getWifiSsid()
     *
     * Returns:
     * - Actual sanitized connected SSID (e.g. "M", "SONA-WIFI")
     * - "SSID_UNAVAILABLE" if cellular, disconnected, permissions denied, or undetectable.
     */
    @JavascriptInterface
    fun getWifiSsid(): String {
        if (!isCallingOriginTrusted()) {
            return "SSID_UNAVAILABLE"
        }

        try {
            val activeNetwork = connectivityManager?.activeNetwork
            val caps = connectivityManager?.getNetworkCapabilities(activeNetwork)
            val isWifi = caps?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true

            if (!isWifi) {
                return "SSID_UNAVAILABLE"
            }

            if (!hasWifiPermissions() || !isLocationServiceEnabled()) {
                return "SSID_UNAVAILABLE"
            }

            val rawSsid = extractCurrentSsid(caps)
            if (rawSsid.isNotBlank() && rawSsid != "<unknown ssid>" && rawSsid != "0x") {
                return rawSsid
            }
        } catch (_: Exception) {
            // Return unavailable on exception
        }

        return "SSID_UNAVAILABLE"
    }

    /**
     * Core method: Returns structured status of the connected network.
     * Response schema:
     * {
     *   "connected": boolean,
     *   "transport": "wifi" | "cellular" | "none" | "other",
     *   "ssid": string | null,
     *   "permissionGranted": boolean,
     *   "locationEnabled": boolean,
     *   "reason": "SUCCESS" | "CELLULAR_DATA" | "DISCONNECTED" | "PERMISSION_DENIED" | "LOCATION_SERVICES_DISABLED" | "SSID_UNAVAILABLE" | "UNTRUSTED_ORIGIN"
     * }
     */
    @JavascriptInterface
    fun getConnectedWifi(): String {
        val json = JSONObject()

        if (!isCallingOriginTrusted()) {
            json.put("connected", false)
            json.put("transport", "unknown")
            json.put("ssid", JSONObject.NULL)
            json.put("permissionGranted", false)
            json.put("locationEnabled", false)
            json.put("reason", "UNTRUSTED_ORIGIN")
            return json.toString()
        }

        try {
            val activeNetwork = connectivityManager?.activeNetwork
            val caps = connectivityManager?.getNetworkCapabilities(activeNetwork)

            val isWifi = caps?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true
            val isCellular = caps?.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) == true
            val isEthernet = caps?.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) == true

            val transport = when {
                isWifi -> "wifi"
                isCellular -> "cellular"
                isEthernet -> "ethernet"
                activeNetwork != null -> "other"
                else -> "none"
            }

            // Case 1: Cellular / Mobile Data
            if (isCellular && !isWifi) {
                json.put("connected", false)
                json.put("transport", "cellular")
                json.put("ssid", JSONObject.NULL)
                json.put("permissionGranted", true)
                json.put("locationEnabled", isLocationServiceEnabled())
                json.put("reason", "CELLULAR_DATA")
                return json.toString()
            }

            // Case 2: No active network connection
            if (!isWifi && activeNetwork == null) {
                json.put("connected", false)
                json.put("transport", "none")
                json.put("ssid", JSONObject.NULL)
                json.put("permissionGranted", true)
                json.put("locationEnabled", isLocationServiceEnabled())
                json.put("reason", "DISCONNECTED")
                return json.toString()
            }

            // Case 3: Other non-wifi transport (e.g. bluetooth, ethernet)
            if (!isWifi) {
                json.put("connected", false)
                json.put("transport", transport)
                json.put("ssid", JSONObject.NULL)
                json.put("permissionGranted", true)
                json.put("locationEnabled", isLocationServiceEnabled())
                json.put("reason", "NOT_WIFI")
                return json.toString()
            }

            // Case 4: Wi-Fi connected, but permission denied
            val permissionGranted = hasWifiPermissions()
            if (!permissionGranted) {
                json.put("connected", true)
                json.put("transport", "wifi")
                json.put("ssid", JSONObject.NULL)
                json.put("permissionGranted", false)
                json.put("locationEnabled", isLocationServiceEnabled())
                json.put("reason", "PERMISSION_DENIED")
                return json.toString()
            }

            // Case 5: Wi-Fi connected and permission granted, but location services disabled
            val locationEnabled = isLocationServiceEnabled()
            if (!locationEnabled) {
                json.put("connected", true)
                json.put("transport", "wifi")
                json.put("ssid", JSONObject.NULL)
                json.put("permissionGranted", true)
                json.put("locationEnabled", false)
                json.put("reason", "LOCATION_SERVICES_DISABLED")
                return json.toString()
            }

            // Case 6: Wi-Fi connected with permissions and location enabled -> Extract SSID
            var rawSsid = extractCurrentSsid(caps)

            if (rawSsid.isNotBlank() && rawSsid != "<unknown ssid>" && rawSsid != "0x") {
                json.put("connected", true)
                json.put("transport", "wifi")
                json.put("ssid", rawSsid)
                json.put("permissionGranted", true)
                json.put("locationEnabled", true)
                json.put("reason", "SUCCESS")
            } else {
                json.put("connected", true)
                json.put("transport", "wifi")
                json.put("ssid", JSONObject.NULL)
                json.put("permissionGranted", true)
                json.put("locationEnabled", true)
                json.put("reason", "SSID_UNAVAILABLE")
            }
        } catch (e: Exception) {
            json.put("connected", false)
            json.put("transport", "unknown")
            json.put("ssid", JSONObject.NULL)
            json.put("permissionGranted", false)
            json.put("locationEnabled", false)
            json.put("reason", e.message ?: "SSID_UNAVAILABLE")
        }
        return json.toString()
    }

    /**
     * Extracts and sanitizes the connected Wi-Fi SSID using multiple Android API strategies.
     */
    private fun extractCurrentSsid(caps: NetworkCapabilities?): String {
        // Strategy A: NetworkCapabilities transportInfo (Android 10+ / API 29+)
        val transportInfo = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            caps?.transportInfo as? WifiInfo
        } else {
            null
        }

        // Strategy B: WifiManager connectionInfo
        @Suppress("DEPRECATION")
        val connInfo = transportInfo ?: wifiManager?.connectionInfo

        var ssid = connInfo?.ssid ?: ""

        // Sanitize Android quotes: "\"M\"" -> "M", "\"SONA-WIFI\"" -> "SONA-WIFI"
        ssid = sanitizeSsid(ssid)

        // Strategy C: NetworkInfo extraInfo fallback if SSID is masked
        if (ssid.isEmpty() || ssid == "<unknown ssid>") {
            @Suppress("DEPRECATION")
            val netInfo = connectivityManager?.getNetworkInfo(ConnectivityManager.TYPE_WIFI)
            val extraInfo = netInfo?.extraInfo
            if (!extraInfo.isNullOrBlank()) {
                val cleanedExtra = sanitizeSsid(extraInfo)
                if (cleanedExtra.isNotBlank() && cleanedExtra != "<unknown ssid>") {
                    ssid = cleanedExtra
                }
            }
        }

        // Strategy D: Match scan results by BSSID if SSID is masked but BSSID is present
        if (ssid.isEmpty() || ssid == "<unknown ssid>") {
            val bssid = connInfo?.bssid ?: ""
            if (bssid.isNotBlank() && bssid != "02:00:00:00:00:00") {
                try {
                    @Suppress("DEPRECATION")
                    val scanResults = wifiManager?.scanResults
                    val match = scanResults?.firstOrNull { it.BSSID.equals(bssid, ignoreCase = true) }
                    if (match != null && !match.SSID.isNullOrBlank() && match.SSID != "<unknown ssid>") {
                        ssid = sanitizeSsid(match.SSID)
                    }
                } catch (_: Exception) {
                    // ignore scan list restriction
                }
            }
        }

        return ssid
    }

    private fun sanitizeSsid(raw: String): String {
        var clean = raw.trim()
        if (clean.startsWith("\"") && clean.endsWith("\"") && clean.length >= 2) {
            clean = clean.substring(1, clean.length - 1).trim()
        }
        return if (clean == "<unknown ssid>" || clean == "0x") "" else clean
    }

    /**
     * Legacy method for full telemetry inspection.
     */
    @JavascriptInterface
    fun getWifiDetails(): String {
        val json = JSONObject()
        try {
            val activeNetwork = connectivityManager?.activeNetwork
            val caps = connectivityManager?.getNetworkCapabilities(activeNetwork)
            val linkProps = connectivityManager?.getLinkProperties(activeNetwork)

            val isWifi = caps?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true
            val hasInternet = caps?.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) == true
            val notVpn = caps?.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_VPN) ?: true
            val isValidated = caps?.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED) ?: false

            val rawSsid = extractCurrentSsid(caps)

            @Suppress("DEPRECATION")
            val connectionInfo: WifiInfo? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                (caps?.transportInfo as? WifiInfo) ?: wifiManager?.connectionInfo
            } else {
                wifiManager?.connectionInfo
            }

            var bssid = connectionInfo?.bssid ?: ""
            if (bssid == "02:00:00:00:00:00") {
                bssid = ""
            }

            val frequency = connectionInfo?.frequency ?: 0
            val band = if (frequency in 4900..5900) "5 GHz" else if (frequency > 0) "2.4 GHz" else "Unknown"
            val linkSpeed = connectionInfo?.linkSpeed ?: 0
            val rssi = connectionInfo?.rssi ?: 0

            var ipv4 = ""
            var ipv6 = ""
            linkProps?.linkAddresses?.forEach { addr ->
                val inetAddr = addr.address
                if (inetAddr is Inet4Address && ipv4.isEmpty()) {
                    ipv4 = inetAddr.hostAddress ?: ""
                } else if (inetAddr is Inet6Address && ipv6.isEmpty() && !inetAddr.isLinkLocalAddress) {
                    ipv6 = inetAddr.hostAddress ?: ""
                }
            }

            var gateway = ""
            var ipv6Gateway = ""
            linkProps?.routes?.forEach { route ->
                if (route.isDefaultRoute) {
                    val gw = route.gateway
                    if (gw is Inet4Address && gateway.isEmpty()) {
                        gateway = gw.hostAddress ?: ""
                    } else if (gw is Inet6Address && ipv6Gateway.isEmpty()) {
                        ipv6Gateway = gw.hostAddress ?: ""
                    }
                }
            }

            val dnsList = linkProps?.dnsServers?.mapNotNull { it.hostAddress } ?: emptyList()
            val dns = dnsList.joinToString(", ")
            val dnsSuffix = linkProps?.domains ?: ""

            json.put("ssid", rawSsid)
            json.put("bssid", bssid)
            json.put("state", if (isWifi) "connected" else "disconnected")
            json.put("isWifi", isWifi)
            json.put("ip", ipv4)
            json.put("ipv6", ipv6)
            json.put("gateway", gateway)
            json.put("ipv6Gateway", ipv6Gateway)
            json.put("dns", dns)
            json.put("dnsSuffix", dnsSuffix)
            json.put("frequency", frequency)
            json.put("band", band)
            json.put("linkSpeed", linkSpeed)
            json.put("rssi", rssi)

            val capsObj = JSONObject().apply {
                put("hasWifi", isWifi)
                put("hasInternet", hasInternet)
                put("notVpn", notVpn)
                put("validated", isValidated)
            }
            json.put("capabilities", capsObj)
        } catch (e: Exception) {
            json.put("state", "disconnected")
            json.put("error", e.message ?: "Failed to read Wi-Fi status")
        }
        return json.toString()
    }
}
