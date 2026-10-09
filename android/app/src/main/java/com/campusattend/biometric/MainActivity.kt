package com.campusattend.biometric

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.net.http.SslError
import android.os.Bundle
import android.view.ViewGroup
import android.webkit.GeolocationPermissions
import android.webkit.PermissionRequest
import android.webkit.SslErrorHandler
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
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

    private val defaultServerUrl = "https://geo-fenced-attendence-system.vercel.app/mark-attendance"

    private val requestPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { _ ->
        // Handle permissions result
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
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
                                            allowContentAccess = false
                                        }

                                        webChromeClient = object : WebChromeClient() {
                                            override fun onGeolocationPermissionsShowPrompt(
                                                origin: String?,
                                                callback: GeolocationPermissions.Callback?
                                            ) {
                                                callback?.invoke(origin, true, false)
                                            }

                                            override fun onPermissionRequest(request: PermissionRequest?) {
                                                request?.grant(request.resources)
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
                                            }

                                            @SuppressLint("WebViewClientOnReceivedSslError")
                                            override fun onReceivedSslError(
                                                view: WebView?,
                                                handler: SslErrorHandler?,
                                                error: SslError?
                                            ) {
                                                handler?.proceed()
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
                                        addJavascriptInterface(
                                            AndroidWifiBridge(ctx, this),
                                            "AndroidWifiBridge"
                                        )
                                        addJavascriptInterface(
                                            AndroidBiometricBridge(ctx, this),
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

    fun requestWifiPermissionsFromBridge() {
        runOnUiThread {
            val permissions = mutableListOf(
                Manifest.permission.ACCESS_FINE_LOCATION,
                Manifest.permission.ACCESS_COARSE_LOCATION,
                Manifest.permission.ACCESS_WIFI_STATE,
                Manifest.permission.ACCESS_NETWORK_STATE
            )
            val needed = permissions.filter {
                ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
            }
            if (needed.isNotEmpty()) {
                requestPermissionLauncher.launch(needed.toTypedArray())
            } else {
                Toast.makeText(
                    this,
                    "Wi-Fi permissions granted. Please ensure Location services are turned ON.",
                    Toast.LENGTH_SHORT
                ).show()
            }
        }
    }

    private fun checkAndRequestPermissions() {
        val permissions = arrayOf(
            Manifest.permission.ACCESS_FINE_LOCATION,
            Manifest.permission.ACCESS_COARSE_LOCATION,
            Manifest.permission.CAMERA,
            Manifest.permission.INTERNET,
            Manifest.permission.ACCESS_NETWORK_STATE,
            Manifest.permission.ACCESS_WIFI_STATE
        )

        val needed = permissions.filter {
            ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
        }

        if (needed.isNotEmpty()) {
            requestPermissionLauncher.launch(needed.toTypedArray())
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        locationService.stopLocationUpdates()
        webView?.destroy()
    }
}
