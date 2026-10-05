package com.campusattend.biometric.wifi

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.wifi.WifiInfo
import android.net.wifi.WifiManager
import android.os.Build
import android.webkit.JavascriptInterface
import android.webkit.WebView
import org.json.JSONObject
import java.net.Inet4Address
import java.net.Inet6Address

/**
 * Native Android Wi-Fi Bridge
 *
 * Exposes authoritative Wi-Fi network telemetry to the WebView application:
 * - SSID & Access Point BSSID
 * - Network capabilities & anti-VPN status
 * - Assigned IPv4 / IPv6 addresses
 * - Default gateway & DNS servers
 * - Frequency band (5 GHz vs 2.4 GHz) & Link speed
 */
class AndroidWifiBridge(
    private val context: Context,
    private val webView: WebView?
) {
    private val wifiManager =
        context.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
    private val connectivityManager =
        context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager

    @JavascriptInterface
    fun isAvailable(): Boolean = true

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

            // Query Wi-Fi info from NetworkCapabilities transportInfo (Android 10+) or WifiManager
            val connectionInfo: WifiInfo? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                (caps?.transportInfo as? WifiInfo) ?: wifiManager?.connectionInfo
            } else {
                wifiManager?.connectionInfo
            }

            var rawSsid = connectionInfo?.ssid ?: ""
            // Remove quotation marks wrapped around SSID in Android: "\"SONA-WIFI\"" -> "SONA-WIFI"
            if (rawSsid.startsWith("\"") && rawSsid.endsWith("\"") && rawSsid.length >= 2) {
                rawSsid = rawSsid.substring(1, rawSsid.length - 1)
            }
            if (rawSsid == "<unknown ssid>") {
                rawSsid = ""
            }

            // Fallback 1: Query ConnectivityManager networkInfo extraInfo if SSID is masked
            if (rawSsid.isEmpty() || rawSsid == "<unknown ssid>") {
                @Suppress("DEPRECATION")
                val netInfo = connectivityManager?.getNetworkInfo(ConnectivityManager.TYPE_WIFI)
                val extraInfo = netInfo?.extraInfo
                if (!extraInfo.isNullOrBlank() && extraInfo != "<unknown ssid>") {
                    var cleanExtra = extraInfo
                    if (cleanExtra.startsWith("\"") && cleanExtra.endsWith("\"") && cleanExtra.length >= 2) {
                        cleanExtra = cleanExtra.substring(1, cleanExtra.length - 1)
                    }
                    if (cleanExtra.isNotBlank() && cleanExtra != "<unknown ssid>") {
                        rawSsid = cleanExtra
                    }
                }
            }

            var bssid = connectionInfo?.bssid ?: ""
            if (bssid == "02:00:00:00:00:00") {
                bssid = "" // Android mask when location permission is restricted
            }

            // Fallback 2: Match SSID from active scan results by BSSID if SSID was masked
            if ((rawSsid.isEmpty() || rawSsid == "<unknown ssid>") && bssid.isNotEmpty()) {
                try {
                    @Suppress("DEPRECATION")
                    val scanList = wifiManager?.scanResults
                    val match = scanList?.firstOrNull { it.BSSID.equals(bssid, ignoreCase = true) }
                    if (match != null && !match.SSID.isNullOrBlank() && match.SSID != "<unknown ssid>") {
                        rawSsid = match.SSID
                    }
                } catch (_: Exception) {
                    // ignore scan list restriction
                }
            }

            val frequency = connectionInfo?.frequency ?: 0
            val band = if (frequency in 4900..5900) "5 GHz" else if (frequency > 0) "2.4 GHz" else "Unknown"
            val linkSpeed = connectionInfo?.linkSpeed ?: 0
            val rssi = connectionInfo?.rssi ?: 0

            // Extract IPv4 & IPv6 addresses from LinkProperties
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

            // Extract IPv4 & IPv6 default gateway from routes
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

            // Fallback to DhcpInfo if LinkProperties did not expose gateway/IP
            if (gateway.isEmpty() || ipv4.isEmpty()) {
                val dhcp = wifiManager?.dhcpInfo
                if (dhcp != null) {
                    if (ipv4.isEmpty() && dhcp.ipAddress != 0) {
                        ipv4 = formatIp(dhcp.ipAddress)
                    }
                    if (gateway.isEmpty() && dhcp.gateway != 0) {
                        gateway = formatIp(dhcp.gateway)
                    }
                }
            }

            // Extract DNS servers
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

    private fun formatIp(ip: Int): String {
        return String.format(
            "%d.%d.%d.%d",
            ip and 0xff,
            ip shr 8 and 0xff,
            ip shr 16 and 0xff,
            ip shr 24 and 0xff
        )
    }
}
