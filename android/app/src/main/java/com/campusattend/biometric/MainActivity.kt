package com.campusattend.biometric

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.net.http.SslError
import android.os.Bundle
import android.view.ViewGroup
import android.webkit.ConsoleMessage
import android.webkit.GeolocationPermissions
import android.webkit.PermissionRequest
import android.webkit.SslErrorHandler
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.util.Log
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import com.campusattend.biometric.bridge.AndroidBiometricBridge
import com.campusattend.biometric.location.AndroidLocationBridge
import com.campusattend.biometric.location.NativeLocationService
import com.campusattend.biometric.wifi.AndroidWifiBridge
import com.campusattend.biometric.ui.theme.CampusAttendBiometricTheme

class MainActivity : ComponentActivity() {

    private lateinit var locationService: NativeLocationService
    private var webView: WebView? = null
    private var wifiBridge: AndroidWifiBridge? = null
    private var biometricBridge: AndroidBiometricBridge? = null

    private val defaultServerUrl = "https://geo-fenced-attendence-system.vercel.app/mark-attendance"

    private val requestPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { _ ->
        wifiBridge?.refreshNetworkCallback(force = true)
        runOnUiThread {
            webView?.evaluateJavascript(
                "if (window.__onAndroidPermissionsChanged) { window.__onAndroidPermissionsChanged(); }",
                null
            )
        }
    }

    private var fileChooserCallback: ValueCallback<Array<Uri>>? = null

    private val fileChooserLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        val callback = fileChooserCallback
        fileChooserCallback = null
        if (callback == null) return@registerForActivityResult

        val results: Array<Uri>? = when {
            result.resultCode != RESULT_OK || result.data == null -> null
            result.data?.data != null -> arrayOf(result.data!!.data!!)
            result.data?.clipData != null -> {
                val clipData = result.data!!.clipData!!
                val list = mutableListOf<Uri>()
                for (i in 0 until clipData.itemCount) {
                    val uri = clipData.getItemAt(i).uri
                    if (uri != null) list.add(uri)
                }
                if (list.isEmpty()) null else list.toTypedArray()
            }
            else -> null
        }
        callback.onReceiveValue(results)
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WebView.setWebContentsDebuggingEnabled(true)
        locationService = NativeLocationService(this)

        checkAndRequestPermissions()

        val prefs = getSharedPreferences("app_config", Context.MODE_PRIVATE)
        var initialUrl = prefs.getString("server_url", defaultServerUrl) ?: defaultServerUrl
        if (initialUrl.contains("localhost") || initialUrl.contains("10.186.230")) {
            initialUrl = defaultServerUrl
            prefs.edit().putString("server_url", defaultServerUrl).apply()
        }

        setContent {
            CampusAttendBiometricTheme {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background
                ) {
                    var currentUrl by remember { mutableStateOf(initialUrl) }
                    var isConfigOpen by remember { mutableStateOf(false) }
                    var urlInput by remember { mutableStateOf(initialUrl) }
                    var isLoadError by remember { mutableStateOf(false) }
                    var errorMessage by remember { mutableStateOf("") }

                    Column(modifier = Modifier.fillMaxSize()) {
                        if (isConfigOpen) {
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .background(MaterialTheme.colorScheme.surfaceVariant)
                                    .padding(8.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                OutlinedTextField(
                                    value = urlInput,
                                    onValueChange = { urlInput = it },
                                    label = { Text("Server URL", fontSize = 12.sp) },
                                    modifier = Modifier.weight(1f),
                                    singleLine = true
                                )
                                Spacer(modifier = Modifier.width(8.dp))
                                Button(
                                    onClick = {
                                        currentUrl = urlInput
                                        prefs.edit().putString("server_url", urlInput).apply()
                                        isLoadError = false
                                        webView?.loadUrl(urlInput)
                                        isConfigOpen = false
                                    }
                                ) {
                                    Text("Load")
                                }
                            }
                        }

                        if (isLoadError) {
                            // Offline / Error retry screen (Requirement 10)
                            Column(
                                modifier = Modifier
                                    .fillMaxSize()
                                    .padding(24.dp),
                                horizontalAlignment = Alignment.CenterHorizontally,
                                verticalArrangement = Arrangement.Center
                            ) {
                                Icon(
                                    imageVector = Icons.Default.Warning,
                                    contentDescription = "Connection Error",
                                    tint = MaterialTheme.colorScheme.error,
                                    modifier = Modifier.size(52.dp)
                                )
                                Spacer(modifier = Modifier.height(16.dp))
                                Text(
                                    text = "Connection Failed",
                                    style = MaterialTheme.typography.titleLarge,
                                    fontWeight = FontWeight.Bold
                                )
                                Spacer(modifier = Modifier.height(8.dp))
                                Text(
                                    text = "Unable to connect to the Attendance Server (${errorMessage.ifEmpty { "Network unavailable" }}).\n\nPlease check your internet connection and try again.",
                                    style = MaterialTheme.typography.bodyMedium,
                                    textAlign = TextAlign.Center,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                                Spacer(modifier = Modifier.height(24.dp))
                                Button(
                                    onClick = {
                                        isLoadError = false
                                        webView?.loadUrl(currentUrl)
                                    }
                                ) {
                                    Icon(
                                        Icons.Default.Refresh,
                                        contentDescription = "Retry",
                                        modifier = Modifier.size(18.dp)
                                    )
                                    Spacer(modifier = Modifier.width(8.dp))
                                    Text("Retry Connection")
                                }
                            }
                        } else {
                            AndroidView(
                                factory = { ctx ->
                                    WebView(ctx).apply {
                                        layoutParams = ViewGroup.LayoutParams(
                                            ViewGroup.LayoutParams.MATCH_PARENT,
                                            ViewGroup.LayoutParams.MATCH_PARENT
                                        )
                                        webView = this

                                        // Strict, secure WebView configuration (Requirement 1 & 9)
                                        settings.apply {
                                            javaScriptEnabled = true
                                            domStorageEnabled = true
                                            setGeolocationEnabled(true)
                                            databaseEnabled = true
                                            mediaPlaybackRequiresUserGesture = false
                                            cacheMode = WebSettings.LOAD_DEFAULT
                                            allowFileAccess = false
                                            allowContentAccess = true
                                            val currentUa = userAgentString ?: ""
                                            if (!currentUa.contains("CampusAttendNative")) {
                                                userAgentString = "$currentUa CampusAttendNative/1.0"
                                            }
                                        }

                                        webChromeClient = object : WebChromeClient() {
                                            override fun onConsoleMessage(consoleMessage: ConsoleMessage?): Boolean {
                                                val msg = consoleMessage?.message() ?: ""
                                                val src = "${consoleMessage?.sourceId()}:${consoleMessage?.lineNumber()}"
                                                when (consoleMessage?.messageLevel()) {
                                                    ConsoleMessage.MessageLevel.ERROR -> Log.e("WebConsole", "[$src] $msg")
                                                    ConsoleMessage.MessageLevel.WARNING -> Log.w("WebConsole", "[$src] $msg")
                                                    else -> Log.d("WebConsole", "[$src] $msg")
                                                }
                                                return true
                                            }

                                            override fun onGeolocationPermissionsShowPrompt(
                                                origin: String?,
                                                callback: GeolocationPermissions.Callback?
                                            ) {
                                                callback?.invoke(origin, true, false)
                                            }

                                            override fun onPermissionRequest(request: PermissionRequest?) {
                                                request?.grant(request.resources)
                                            }

                                            override fun onShowFileChooser(
                                                view: WebView?,
                                                filePathCallback: ValueCallback<Array<Uri>>?,
                                                fileChooserParams: FileChooserParams?
                                            ): Boolean {
                                                // Cancel previous callback to prevent WebView file chooser deadlock
                                                fileChooserCallback?.onReceiveValue(null)
                                                fileChooserCallback = filePathCallback

                                                return try {
                                                    val intent = Intent(Intent.ACTION_GET_CONTENT).apply {
                                                        type = "image/*"
                                                        addCategory(Intent.CATEGORY_OPENABLE)
                                                        if (fileChooserParams?.mode == FileChooserParams.MODE_OPEN_MULTIPLE) {
                                                            putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
                                                        }
                                                        val acceptTypes = fileChooserParams?.acceptTypes?.filter { it.isNotBlank() }
                                                        if (!acceptTypes.isNullOrEmpty() && acceptTypes[0] != "*/*") {
                                                            putExtra(Intent.EXTRA_MIME_TYPES, acceptTypes.toTypedArray())
                                                        }
                                                    }
                                                    val chooser = Intent.createChooser(intent, "Select Reference Face Photos")
                                                    fileChooserLauncher.launch(chooser)
                                                    true
                                                } catch (e: Exception) {
                                                    fileChooserCallback?.onReceiveValue(null)
                                                    fileChooserCallback = null
                                                    false
                                                }
                                            }
                                        }

                                        webViewClient = object : WebViewClient() {
                                            // WebView origin security: only trusted host can load in this WebView
                                            override fun shouldOverrideUrlLoading(
                                                view: WebView?,
                                                request: WebResourceRequest?
                                            ): Boolean {
                                                val uri = request?.url ?: return false
                                                val host = uri.host?.lowercase() ?: ""
                                                val trustedHosts = listOf(
                                                    "geo-fenced-attendence-system.vercel.app",
                                                    "localhost",
                                                    "127.0.0.1",
                                                    "10.0.2.2"
                                                )
                                                val isTrusted = trustedHosts.any { host == it || host.endsWith(".$it") }
                                                if (isTrusted) {
                                                    return false // Load internally
                                                }

                                                // Intercept external links and open in external system browser
                                                try {
                                                    val intent = android.content.Intent(
                                                        android.content.Intent.ACTION_VIEW,
                                                        uri
                                                    )
                                                    ctx.startActivity(intent)
                                                } catch (_: Exception) {}
                                                return true
                                            }

                                            override fun onPageStarted(
                                                view: WebView?,
                                                url: String?,
                                                favicon: android.graphics.Bitmap?
                                            ) {
                                                super.onPageStarted(view, url, favicon)
                                                isLoadError = false
                                                wifiBridge?.setCurrentUrl(url)
                                                biometricBridge?.setCurrentUrl(url)
                                            }

                                            override fun onReceivedSslError(
                                                view: WebView?,
                                                handler: SslErrorHandler?,
                                                error: SslError?
                                            ) {
                                                // Preserve HTTPS certificate validation without bypasses
                                                handler?.cancel()
                                            }

                                            override fun onReceivedError(
                                                view: WebView?,
                                                request: WebResourceRequest?,
                                                error: WebResourceError?
                                            ) {
                                                if (request?.isForMainFrame == true) {
                                                    isLoadError = true
                                                    errorMessage = error?.description?.toString() ?: "Network error"
                                                }
                                            }
                                        }

                                        addJavascriptInterface(
                                            AndroidLocationBridge(ctx, locationService, this),
                                            "AndroidLocationBridge"
                                        )
                                        val bridge = AndroidWifiBridge(ctx, this)
                                        bridge.setCurrentUrl(currentUrl)
                                        wifiBridge = bridge
                                        addJavascriptInterface(
                                            bridge,
                                            "AndroidWifiBridge"
                                        )
                                        val bioBridge = AndroidBiometricBridge(ctx, this)
                                        bioBridge.setCurrentUrl(currentUrl)
                                        biometricBridge = bioBridge
                                        addJavascriptInterface(
                                            bioBridge,
                                            "AndroidBiometricBridge"
                                        )

                                        loadUrl(currentUrl)
                                    }
                                },
                                modifier = Modifier
                                    .weight(1f)
                                    .fillMaxWidth()
                            )
                        }
                    }
                }
            }
        }
    }

    override fun onResume() {
        super.onResume()
        wifiBridge?.refreshNetworkCallback(force = false)
        runOnUiThread {
            webView?.evaluateJavascript(
                "if (window.__onAndroidPermissionsChanged) { window.__onAndroidPermissionsChanged(); }",
                null
            )
        }
    }

    fun requestWifiPermissionsFromBridge() {
        runOnUiThread {
            val permissions = mutableListOf(
                Manifest.permission.ACCESS_FINE_LOCATION,
                Manifest.permission.ACCESS_COARSE_LOCATION,
                Manifest.permission.ACCESS_WIFI_STATE,
                Manifest.permission.ACCESS_NETWORK_STATE
            )
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.TIRAMISU) {
                permissions.add(Manifest.permission.NEARBY_WIFI_DEVICES)
            }
            val needed = permissions.filter {
                ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
            }
            if (needed.isNotEmpty()) {
                requestPermissionLauncher.launch(needed.toTypedArray())
            } else {
                val locationManager = getSystemService(Context.LOCATION_SERVICE) as? android.location.LocationManager
                val isLocEnabled = locationManager?.let { androidx.core.location.LocationManagerCompat.isLocationEnabled(it) } ?: true
                if (!isLocEnabled) {
                    Toast.makeText(
                        this,
                        "Please turn ON device Location in Android settings to allow reading Wi-Fi name.",
                        Toast.LENGTH_LONG
                    ).show()
                    try {
                        startActivity(android.content.Intent(android.provider.Settings.ACTION_LOCATION_SOURCE_SETTINGS))
                    } catch (_: Exception) {}
                } else {
                    wifiBridge?.refreshNetworkCallback()
                    Toast.makeText(
                        this,
                        "All Wi-Fi permissions are granted.",
                        Toast.LENGTH_SHORT
                    ).show()
                }
            }
        }
    }

    private fun checkAndRequestPermissions() {
        val permissions = mutableListOf(
            Manifest.permission.ACCESS_FINE_LOCATION,
            Manifest.permission.ACCESS_COARSE_LOCATION,
            Manifest.permission.CAMERA,
            Manifest.permission.INTERNET,
            Manifest.permission.ACCESS_NETWORK_STATE,
            Manifest.permission.ACCESS_WIFI_STATE
        )
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.TIRAMISU) {
            permissions.add(Manifest.permission.NEARBY_WIFI_DEVICES)
        }

        val needed = permissions.filter {
            ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
        }

        if (needed.isNotEmpty()) {
            requestPermissionLauncher.launch(needed.toTypedArray())
        }
    }

    override fun onDestroy() {
        fileChooserCallback?.onReceiveValue(null)
        fileChooserCallback = null
        wifiBridge?.unregisterWifiNetworkCallback()
        super.onDestroy()
        locationService.stopLocationUpdates()
        webView?.destroy()
    }
}
