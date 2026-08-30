package com.campusattend.biometric.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.campusattend.biometric.location.NativeLocationReading
import com.campusattend.biometric.location.NativeLocationService
import com.campusattend.biometric.location.NativeLocationSessionState
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LocationVerificationScreen(
    locationService: NativeLocationService,
    onAttendanceDecision: (Boolean) -> Unit = {}
) {
    val context = LocalContext.current
    var sessionState by remember {
        mutableStateOf(
            NativeLocationSessionState(
                status = "IDLE",
                rawAccuracy = null,
                bestAccuracy = null,
                readingsCollected = 0,
                positionStability = "MEASURING",
                consecutiveGoodCount = 0,
                isInsideGeofence = null,
                isAttendanceAllowed = false,
                currentReading = null,
                readingsHistory = emptyList()
            )
        )
    }

    var isAcquiring by remember { mutableStateOf(false) }

    fun startAcquisition() {
        isAcquiring = true
        locationService.startLocationStream(maxSamples = 10) { state ->
            sessionState = state
            if (state.status != "ACQUIRING") {
                isAcquiring = false
            }
        }
    }

    LaunchedEffect(Unit) {
        startAcquisition()
    }

    DisposableEffect(Unit) {
        onDispose {
            locationService.stopLocationUpdates()
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(
                            text = "Native GPS & 5-Point Geofence",
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.Bold
                        )
                        Text(
                            text = "FusedLocationProviderClient · 2D Kalman Filter",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                },
                actions = {
                    IconButton(
                        onClick = { startAcquisition() },
                        enabled = !isAcquiring
                    ) {
                        Icon(
                            imageVector = Icons.Default.Refresh,
                            contentDescription = "Refresh GPS"
                        )
                    }
                }
            )
        }
    ) { paddingValues ->
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
                .padding(horizontal = 16.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            // ── 1. LOCATION SOURCE & STATUS BANNER ──
            item {
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    colors = CardDefaults.cardColors(
                        containerColor = MaterialTheme.colorScheme.surfaceVariant
                    ),
                    shape = RoundedCornerShape(12.dp)
                ) {
                    Column(modifier = Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text(
                                text = "LOCATION SOURCE",
                                style = MaterialTheme.typography.labelSmall,
                                fontWeight = FontWeight.Bold,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                            Badge(
                                containerColor = MaterialTheme.colorScheme.primaryContainer,
                                contentColor = MaterialTheme.colorScheme.onPrimaryContainer
                            ) {
                                Text("NATIVE FUSED", fontWeight = FontWeight.Bold, modifier = Modifier.padding(horizontal = 4.dp, vertical = 2.dp))
                            }
                        }

                        // Decision Status
                        val statusBg = when (sessionState.status) {
                            "INSIDE" -> Color(0xFF1B5E20)
                            "OUTSIDE" -> Color(0xFFB71C1C)
                            "INSUFFICIENT_ACCURACY" -> Color(0xFFE65100)
                            else -> MaterialTheme.colorScheme.secondaryContainer
                        }

                        val statusText = when (sessionState.status) {
                            "INSIDE" -> "INSIDE 5-POINT POLYGON (GPS PASS)"
                            "OUTSIDE" -> "OUTSIDE 5-POINT POLYGON (GPS REJECTED)"
                            "INSUFFICIENT_ACCURACY" -> "GPS ACCURACY INSUFFICIENT (>20m)"
                            "LOCATION_DISABLED" -> "LOCATION HARDWARE DISABLED"
                            "PERMISSION_DENIED" -> "PRECISE LOCATION PERMISSION REQUIRED"
                            else -> "ACQUIRING FRESH HIGH-ACCURACY FIX…"
                        }

                        Box(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(8.dp))
                                .background(statusBg)
                                .padding(vertical = 8.dp, horizontal = 12.dp),
                            contentAlignment = Alignment.Center
                        ) {
                            Text(
                                text = statusText,
                                style = MaterialTheme.typography.labelMedium,
                                fontWeight = FontWeight.Bold,
                                color = Color.White
                            )
                        }

                        if (sessionState.status == "LOCATION_DISABLED") {
                            Button(
                                onClick = { context.startActivity(locationService.getLocationSettingsIntent()) },
                                modifier = Modifier.fillMaxWidth().padding(top = 4.dp),
                                colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error)
                            ) {
                                Icon(Icons.Default.Settings, contentDescription = null, modifier = Modifier.size(16.dp))
                                Spacer(modifier = Modifier.width(8.dp))
                                Text("Open Location Settings")
                            }
                        }
                    }
                }
            }

            // ── 2. CORE TELEMETRY METRICS ──
            item {
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(12.dp),
                    border = CardDefaults.outlinedCardBorder()
                ) {
                    Column(modifier = Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(
                            text = "TELEMETRY & QUALITY GATING",
                            style = MaterialTheme.typography.labelSmall,
                            fontWeight = FontWeight.Bold,
                            color = MaterialTheme.colorScheme.primary
                        )

                        val reading = sessionState.currentReading

                        MetricRow(
                            label = "1. Raw Latitude",
                            value = reading?.let { "%.7f° N".format(it.rawLatitude) } ?: "—"
                        )
                        MetricRow(
                            label = "2. Raw Longitude",
                            value = reading?.let { "%.7f° E".format(it.rawLongitude) } ?: "—"
                        )
                        MetricRow(
                            label = "3. Raw Accuracy",
                            value = sessionState.rawAccuracy?.let { "±%.1f m".format(it) } ?: "—",
                            highlight = sessionState.rawAccuracy != null && sessionState.rawAccuracy!! <= 20f
                        )
                        MetricRow(
                            label = "4. Best Accuracy",
                            value = sessionState.bestAccuracy?.let { "±%.1f m".format(it) } ?: "—"
                        )
                        MetricRow(
                            label = "5. Filtered Latitude",
                            value = reading?.let { "%.7f° N".format(it.filteredLatitude) } ?: "—"
                        )
                        MetricRow(
                            label = "6. Filtered Longitude",
                            value = reading?.let { "%.7f° E".format(it.filteredLongitude) } ?: "—"
                        )
                        MetricRow(
                            label = "7. Readings Collected",
                            value = "${sessionState.readingsCollected} (${sessionState.consecutiveGoodCount}/2 good fixes)"
                        )
                        MetricRow(
                            label = "8. Position Stability",
                            value = sessionState.positionStability,
                            highlight = sessionState.positionStability == "STABLE"
                        )
                        MetricRow(
                            label = "9. Geofence Containment",
                            value = when (sessionState.isInsideGeofence) {
                                true -> "INSIDE 5-POINT POLYGON"
                                false -> "OUTSIDE POLYGON"
                                else -> "Evaluating…"
                            },
                            highlight = sessionState.isInsideGeofence == true
                        )
                        MetricRow(
                            label = "10. Attendance Authorization",
                            value = if (sessionState.isAttendanceAllowed) "GPS FACTOR PASS" else "GPS FACTOR BLOCKED",
                            highlight = sessionState.isAttendanceAllowed
                        )
                    }
                }
            }

            // ── 3. COLLECTED READINGS LOG TABLE ──
            item {
                Text(
                    text = "COLLECTED HIGH-ACCURACY READINGS (${sessionState.readingsHistory.size})",
                    style = MaterialTheme.typography.labelSmall,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }

            items(sessionState.readingsHistory) { r ->
                val timeStr = SimpleDateFormat("HH:mm:ss.SSS", Locale.getDefault()).format(Date(r.timestamp))
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(8.dp),
                    colors = CardDefaults.cardColors(
                        containerColor = MaterialTheme.colorScheme.surface
                    ),
                    border = CardDefaults.outlinedCardBorder()
                ) {
                    Column(modifier = Modifier.padding(10.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween
                        ) {
                            Text(
                                text = "#${r.sampleIndex} · $timeStr · ${r.provider.uppercase()}",
                                style = MaterialTheme.typography.labelSmall,
                                fontWeight = FontWeight.Bold,
                                fontFamily = FontFamily.Monospace
                            )
                            Badge(
                                containerColor = if (r.rawAccuracyMeters <= 10f) Color(0xFF2E7D32) else if (r.rawAccuracyMeters <= 20f) Color(0xFF1565C0) else Color(0xFFC62828)
                            ) {
                                Text("±%.1fm (${r.quality})".format(r.rawAccuracyMeters), color = Color.White, fontSize = 10.sp)
                            }
                        }

                        Text(
                            text = "Raw: %.6f°, %.6f°".format(r.rawLatitude, r.rawLongitude),
                            style = MaterialTheme.typography.bodySmall,
                            fontFamily = FontFamily.Monospace
                        )

                        Text(
                            text = "Kalman: %.6f°, %.6f° (${r.kalmanStatus})".format(r.filteredLatitude, r.filteredLongitude),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.primary,
                            fontFamily = FontFamily.Monospace
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun MetricRow(label: String, value: String, highlight: Boolean = false) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
        Text(
            text = value,
            style = MaterialTheme.typography.bodySmall,
            fontWeight = if (highlight) FontWeight.Bold else FontWeight.Normal,
            fontFamily = FontFamily.Monospace,
            color = if (highlight) Color(0xFF2E7D32) else MaterialTheme.colorScheme.onSurface
        )
    }
}
