package com.campusattend.biometric.wifi

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.location.LocationManager
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.net.wifi.WifiInfo
import android.net.wifi.WifiManager
import android.os.Build
import android.provider.Settings
import android.util.Log
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
 * Exposes real device connected Wi-Fi SSID, transport status, and safe diagnostics to the web application:
 * - Direct SSID extraction via NetworkCallback with FLAG_INCLUDE_LOCATION_INFO (API 31+)
 * - Robust fallback to WifiManager & NetworkCapabilities
 * - Strict Android permission checks (ACCESS_FINE_LOCATION and NEARBY_WIFI_DEVICES on API 33+)
 * - Native location services state verification
 * - Seamless re-registration upon permission grant / activity resume
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

    @Volatile
    private var callbackSsid: String? = null

    @Volatile
    private var ssidSource: String = "NONE"

    @Volatile
    private var isCallbackRegistered: Boolean = false

    private val callbackLock = Any()

    init {
        registerWifiNetworkCallback()
    }

    /**
     * Registers both default and Wi-Fi network callbacks with FLAG_INCLUDE_LOCATION_INFO (API 31+).
     * Automatically handles re-registration if permissions were granted after initial creation.
     */
    fun registerWifiNetworkCallback() {
        synchronized(callbackLock) {
            if (isCallbackRegistered) return

            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && connectivityManager != null) {
                    if (!hasWifiPermissions()) {
                        Log.d("AndroidWifiBridge", "Skipping callback registration: permissions not yet granted")
                        return@synchronized
                    }

                    // 1. Default Network Callback (captures active routing network unredacted)
                    val defaultCallback = object : ConnectivityManager.NetworkCallback(FLAG_INCLUDE_LOCATION_INFO) {
                        override fun onCapabilitiesChanged(
                            network: Network,
                            networkCapabilities: NetworkCapabilities
                        ) {
                            handleCapabilitiesChanged(networkCapabilities, "DEFAULT_CALLBACK")
                        }

                        override fun onLost(network: Network) {
                            if (ssidSource == "DEFAULT_CALLBACK") {
                                callbackSsid = null
                                ssidSource = "NONE"
                            }
                        }
                    }

                    // 2. Wi-Fi Specific Callback with clearCapabilities() to match any Wi-Fi connection
                    val wifiRequest = NetworkRequest.Builder()
                        .clearCapabilities()
                        .addTransportType(NetworkCapabilities.TRANSPORT_WIFI)
                        .build()

                    val wifiCallback = object : ConnectivityManager.NetworkCallback(FLAG_INCLUDE_LOCATION_INFO) {
                        override fun onCapabilitiesChanged(
                            network: Network,
                            networkCapabilities: NetworkCapabilities
                        ) {
                            handleCapabilitiesChanged(networkCapabilities, "WIFI_CALLBACK")
                        }

                        override fun onLost(network: Network) {
                            if (ssidSource == "WIFI_CALLBACK") {
                                callbackSsid = null
                                ssidSource = "NONE"
                            }
                        }
                    }

                    try {
                        connectivityManager.registerDefaultNetworkCallback(defaultCallback)
                    } catch (e: Exception) {
                        Log.w("AndroidWifiBridge", "registerDefaultNetworkCallback fallback: ${e.message}")
                    }

                    try {
                        connectivityManager.registerNetworkCallback(wifiRequest, wifiCallback)
                    } catch (e: Exception) {
                        Log.w("AndroidWifiBridge", "registerNetworkCallback fallback: ${e.message}")
                    }

                    isCallbackRegistered = true
                    Log.i("AndroidWifiBridge", "NetworkCallbacks registered successfully with FLAG_INCLUDE_LOCATION_INFO")
                }
                Unit
            } catch (e: Exception) {
                Log.w("AndroidWifiBridge", "NetworkCallback registration exception: ${e.message}")
            }
            return@synchronized
        }
    }

    private fun handleCapabilitiesChanged(caps: NetworkCapabilities, source: String) {
        val wifiInfo = caps.transportInfo as? WifiInfo
        val raw = wifiInfo?.ssid
        if (!raw.isNullOrBlank()) {
            val clean = sanitizeSsid(raw)
            if (clean.isNotEmpty()) {
                callbackSsid = clean
                ssidSource = source
                Log.d("AndroidWifiBridge", "Unredacted SSID received via $source: $clean")
            }
        }
    }

    /**
     * Re-attempts network callback registration when permissions or lifecycle state change.
     */
    fun refreshNetworkCallback() {
        if (!isCallbackRegistered && hasWifiPermissions()) {
            registerWifiNetworkCallback()
        }
    }

    @JavascriptInterface
    fun isAvailable(): Boolean = true

    /**
     * Origin verification to ensure only the trusted Vercel application
     * or authorized local development hosts can invoke native Wi-Fi methods.
     */
    private fun isCallingOriginTrusted(): Boolean {
        val currentUrl = webView?.url ?: webView?.originalUrl ?: return true
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
     * - Android 12 & below: ACCESS_FINE_LOCATION
     * - Android 13+ (API 33+): ACCESS_FINE_LOCATION AND NEARBY_WIFI_DEVICES
     */
    fun hasWifiPermissions(): Boolean {
        val fineGranted = ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.ACCESS_FINE_LOCATION
        ) == PackageManager.PERMISSION_GRANTED

        val nearbyGranted = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.NEARBY_WIFI_DEVICES
            ) == PackageManager.PERMISSION_GRANTED
        } else {
            true
        }

        return fineGranted && nearbyGranted
    }

    /**
     * Checks if device-level location services are turned ON.
     * Android requires location services to be enabled for apps to read the connected Wi-Fi SSID.
     */
    fun isLocationServiceEnabled(): Boolean {
        return if (locationManager != null) {
            LocationManagerCompat.isLocationEnabled(locationManager)
        } else {
            true
        }
    }

    /**
     * Requests the required permissions via the native Android Activity UI dialog.
     */
    @JavascriptInterface
    fun requestWifiPermissions(): Boolean {
        val activity = context as? MainActivity
        activity?.requestWifiPermissionsFromBridge()
        return true
    }

    /**
     * Launches Android system location settings screen if device location toggle is OFF.
     */
    @JavascriptInterface
    fun openLocationSettings(): Boolean {
        return try {
            val intent = Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS)
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(intent)
            true
        } catch (_: Exception) {
            false
        }
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
     * Obtains the connected network-level fingerprint along with safe diagnostics.
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

            val (detectedSsid, source) = extractCurrentSsid(caps)
            json.put("ssid", if (detectedSsid.isNotEmpty()) detectedSsid else JSONObject.NULL)
            json.put("ssidSource", source)
            json.put("ipv4", if (ipv4.isNotEmpty()) ipv4 else JSONObject.NULL)
            json.put("ipv4Subnet", if (ipv4Subnet.isNotEmpty()) ipv4Subnet else JSONObject.NULL)
            json.put("prefixLength", prefixLength)
            json.put("gateway", if (gateway.isNotEmpty()) gateway else JSONObject.NULL)
            json.put("dnsServers", dnsServers)
            json.put("reason", "SUCCESS")

            // Safe diagnostics
            json.put("apiLevel", Build.VERSION.SDK_INT)
            json.put("hasFineLocation", ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED)
            json.put("hasNearbyWifi", if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) ContextCompat.checkSelfPermission(context, Manifest.permission.NEARBY_WIFI_DEVICES) == PackageManager.PERMISSION_GRANTED else true)
            json.put("isLocationEnabled", isLocationServiceEnabled())

        } catch (e: Exception) {
            json.put("transport", "unknown")
            json.put("isWifi", false)
            json.put("reason", e.message ?: "FINGERPRINT_EXTRACTION_FAILED")
        }

        return json.toString()
    }

    /**
     * Direct string query method for SSID retrieval.
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

            val (rawSsid, _) = extractCurrentSsid(caps)
            if (rawSsid.isNotBlank() && rawSsid != "<unknown ssid>" && rawSsid != "0x") {
                return rawSsid
            }
        } catch (_: Exception) {}

        return "SSID_UNAVAILABLE"
    }

    /**
     * Core method: Returns structured status of the connected network and safe diagnostics.
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

            val hasFineLoc = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
            val hasNearby = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) ContextCompat.checkSelfPermission(context, Manifest.permission.NEARBY_WIFI_DEVICES) == PackageManager.PERMISSION_GRANTED else true
            val permissionGranted = hasWifiPermissions()
            val locationEnabled = isLocationServiceEnabled()

            // Attach safe diagnostics
            json.put("apiLevel", Build.VERSION.SDK_INT)
            json.put("hasFineLocation", hasFineLoc)
            json.put("hasNearbyWifi", hasNearby)
            json.put("permissionGranted", permissionGranted)
            json.put("locationEnabled", locationEnabled)

            // Case 1: Cellular / Mobile Data
            if (isCellular && !isWifi) {
                json.put("connected", false)
                json.put("transport", "cellular")
                json.put("ssid", JSONObject.NULL)
                json.put("ssidSource", "NONE")
                json.put("reason", "CELLULAR_DATA")
                return json.toString()
            }

            // Case 2: No active network connection
            if (!isWifi && activeNetwork == null) {
                json.put("connected", false)
                json.put("transport", "none")
                json.put("ssid", JSONObject.NULL)
                json.put("ssidSource", "NONE")
                json.put("reason", "DISCONNECTED")
                return json.toString()
            }

            // Case 3: Other non-wifi transport (e.g. bluetooth, ethernet)
            if (!isWifi) {
                json.put("connected", false)
                json.put("transport", transport)
                json.put("ssid", JSONObject.NULL)
                json.put("ssidSource", "NONE")
                json.put("reason", "NOT_WIFI")
                return json.toString()
            }

            // Case 4: Wi-Fi connected, but permission denied
            if (!permissionGranted) {
                json.put("connected", true)
                json.put("transport", "wifi")
                json.put("ssid", JSONObject.NULL)
                json.put("ssidSource", "NONE")
                json.put("reason", "PERMISSION_DENIED")
                return json.toString()
            }

            // Case 5: Wi-Fi connected and permission granted, but location services disabled
            if (!locationEnabled) {
                json.put("connected", true)
                json.put("transport", "wifi")
                json.put("ssid", JSONObject.NULL)
                json.put("ssidSource", "NONE")
                json.put("reason", "LOCATION_SERVICES_DISABLED")
                return json.toString()
            }

            // Case 6: Wi-Fi connected with permissions and location enabled -> Extract SSID
            val (rawSsid, source) = extractCurrentSsid(caps)
            json.put("ssidSource", source)

            if (rawSsid.isNotBlank() && rawSsid != "<unknown ssid>" && rawSsid != "0x") {
                json.put("connected", true)
                json.put("transport", "wifi")
                json.put("ssid", rawSsid)
                json.put("reason", "SUCCESS")
            } else {
                json.put("connected", true)
                json.put("transport", "wifi")
                json.put("ssid", JSONObject.NULL)
                json.put("reason", "SSID_UNAVAILABLE")
            }
        } catch (e: Exception) {
            json.put("connected", false)
            json.put("transport", "unknown")
            json.put("ssid", JSONObject.NULL)
            json.put("permissionGranted", false)
            json.put("locationEnabled", false)
            json.put("ssidSource", "NONE")
            json.put("reason", e.message ?: "SSID_UNAVAILABLE")
        }
        return json.toString()
    }

    /**
     * Extracts and sanitizes connected Wi-Fi SSID using multiple resilient Android API strategies:
     * 1. Cached NetworkCallback with FLAG_INCLUDE_LOCATION_INFO (API 31+)
     * 2. Brief wait (up to 1000ms) on bridge thread if callback is warming up
     * 3. Direct WifiManager connectionInfo
     * 4. NetworkCapabilities transportInfo from active network
     * 5. NetworkInfo extraInfo fallback
     */
    private fun extractCurrentSsid(caps: NetworkCapabilities?): Pair<String, String> {
        // Step 1: Ensure callbacks are active if permissions are held
        if (!isCallbackRegistered && hasWifiPermissions()) {
            registerWifiNetworkCallback()
        }

        // Step 2: Check if callback already has the SSID
        val fromCallback = callbackSsid
        if (!fromCallback.isNullOrBlank()) {
            val clean = sanitizeSsid(fromCallback)
            if (clean.isNotEmpty()) {
                return Pair(clean, ssidSource)
            }
        }

        // Step 3: If on Android 12+ and callback is registered, wait up to 1000ms for callback dispatch
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && isCallbackRegistered) {
            var waited = 0
            while (callbackSsid.isNullOrBlank() && waited < 1000) {
                try {
                    Thread.sleep(100)
                } catch (_: InterruptedException) {
                    break
                }
                waited += 100
            }
            val lateCbSsid = callbackSsid
            if (!lateCbSsid.isNullOrBlank()) {
                val clean = sanitizeSsid(lateCbSsid)
                if (clean.isNotEmpty()) {
                    return Pair(clean, ssidSource)
                }
            }
        }

        // Step 4: WifiManager connectionInfo fallback (deprecated on API 31+, but valid on older/some OEM builds)
        try {
            @Suppress("DEPRECATION")
            val wifiInfo = wifiManager?.connectionInfo
            if (wifiInfo != null && !wifiInfo.ssid.isNullOrBlank()) {
                val clean = sanitizeSsid(wifiInfo.ssid)
                if (clean.isNotEmpty()) {
                    return Pair(clean, "WIFI_MANAGER")
                }
            }
        } catch (_: Exception) {}

        // Step 5: NetworkCapabilities transportInfo fallback (Android 10+ / API 29+)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && caps != null) {
            try {
                val transportInfo = caps.transportInfo as? WifiInfo
                if (transportInfo != null && !transportInfo.ssid.isNullOrBlank()) {
                    val clean = sanitizeSsid(transportInfo.ssid)
                    if (clean.isNotEmpty()) {
                        return Pair(clean, "TRANSPORT_INFO")
                    }
                }
            } catch (_: Exception) {}
        }

        // Step 6: NetworkInfo extraInfo fallback
        try {
            @Suppress("DEPRECATION")
            val netInfo = connectivityManager?.getNetworkInfo(ConnectivityManager.TYPE_WIFI)
            val extraInfo = netInfo?.extraInfo
            if (!extraInfo.isNullOrBlank()) {
                val cleanedExtra = sanitizeSsid(extraInfo)
                if (cleanedExtra.isNotBlank()) {
                    return Pair(cleanedExtra, "EXTRA_INFO")
                }
            }
        } catch (_: Exception) {}

        return Pair("", "NONE")
    }

    private fun sanitizeSsid(raw: String): String {
        var clean = raw.trim()
        if (clean.startsWith("\"") && clean.endsWith("\"") && clean.length >= 2) {
            clean = clean.substring(1, clean.length - 1).trim()
        }
        return if (clean == "<unknown ssid>" || clean == "0x" || clean.equals("ssid_unavailable", ignoreCase = true)) "" else clean
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

            val (rawSsid, source) = extractCurrentSsid(caps)

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
            json.put("ssidSource", source)
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
