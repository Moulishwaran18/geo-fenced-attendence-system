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
     * Checks if the required runtime permissions to obtain the Wi-Fi SSID are granted.
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

        val nearbyGranted = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.NEARBY_WIFI_DEVICES
            ) == PackageManager.PERMISSION_GRANTED
        } else {
            true
        }

        return (fineGranted || coarseGranted) && nearbyGranted
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

    /**
     * Core method: Returns structured status of the connected network.
     * Response schema:
     * {
     *   "connected": boolean,
     *   "transport": "wifi" | "cellular" | "none" | "other",
     *   "ssid": string | null,
     *   "permissionGranted": boolean,
     *   "locationEnabled": boolean,
     *   "reason": "SUCCESS" | "CELLULAR_DATA" | "DISCONNECTED" | "PERMISSION_DENIED" | "LOCATION_SERVICES_DISABLED" | "SSID_UNAVAILABLE"
     * }
     */
    @JavascriptInterface
    fun getConnectedWifi(): String {
        val json = JSONObject()
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
