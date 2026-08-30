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
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Settings
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
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import com.campusattend.biometric.location.AndroidLocationBridge
import com.campusattend.biometric.location.NativeLocationService
import com.campusattend.biometric.ui.theme.CampusAttendBiometricTheme

class MainActivity : ComponentActivity() {

    private lateinit var locationService: NativeLocationService
    private var webView: WebView? = null

    private val defaultServerUrl = "https://localhost:8080/mark-attendance"
    private val lanServerUrl = "https://10.186.230.182:8080/mark-attendance"

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
        val initialUrl = prefs.getString("server_url", defaultServerUrl) ?: defaultServerUrl

        setContent {
            CampusAttendBiometricTheme {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background
                ) {
                    var currentUrl by remember { mutableStateOf(initialUrl) }
                    var isConfigOpen by remember { mutableStateOf(false) }
                    var urlInput by remember { mutableStateOf(initialUrl) }

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
                                        webView?.loadUrl(urlInput)
                                        isConfigOpen = false
                                    }
                                ) {
                                    Text("Load")
                                }
                            }
                        }

                        AndroidView(
                            factory = { ctx ->
                                WebView(ctx).apply {
                                    layoutParams = ViewGroup.LayoutParams(
                                        ViewGroup.LayoutParams.MATCH_PARENT,
                                        ViewGroup.LayoutParams.MATCH_PARENT
                                    )
                                    webView = this
                                    settings.apply {
                                        javaScriptEnabled = true
                                        domStorageEnabled = true
                                        setGeolocationEnabled(true)
                                        databaseEnabled = true
                                        mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
                                        mediaPlaybackRequiresUserGesture = false
                                        cacheMode = WebSettings.LOAD_DEFAULT
                                        allowFileAccess = true
                                        allowContentAccess = true
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
                                        @SuppressLint("WebViewClientOnReceivedSslError")
                                        override fun onReceivedSslError(
                                            view: WebView?,
                                            handler: SslErrorHandler?,
                                            error: SslError?
                                        ) {
                                            // Allow local Vite dev server SSL certificates
                                            handler?.proceed()
                                        }

                                        override fun onReceivedError(
                                            view: WebView?,
                                            request: WebResourceRequest?,
                                            error: WebResourceError?
                                        ) {
                                            if (request?.isForMainFrame == true) {
                                                val failingUrl = request.url.toString()
                                                if (failingUrl.contains("localhost")) {
                                                    post {
                                                        loadUrl(lanServerUrl)
                                                    }
                                                } else if (failingUrl.contains("10.186.230.182")) {
                                                    post {
                                                        loadUrl(defaultServerUrl)
                                                    }
                                                }
                                            }
                                        }
                                    }

                                    addJavascriptInterface(
                                        AndroidLocationBridge(ctx, locationService, this),
                                        "AndroidLocationBridge"
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
