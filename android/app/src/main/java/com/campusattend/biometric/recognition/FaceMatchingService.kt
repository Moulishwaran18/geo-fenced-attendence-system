package com.campusattend.biometric.recognition

import com.campusattend.biometric.config.BiometricConfig
import com.campusattend.biometric.data.FaceEmbeddingEntity
import com.campusattend.biometric.data.StaffEntity

/**
 * Face matching service for comparing live embeddings against enrolled database.
 *
 * Port of: src/lib/face-recognition/face-matching.ts
 *
 * Uses cosine distance (1 - cosine_similarity) for L2-normalized vectors.
 * Requires:
 * - Best match within threshold
 * - Adequate margin over second-best match from different identity
 *
 * Does NOT simply choose the closest identity.
 */
class FaceMatchingService {

    /**
     * Find the best matching identity for a live face embedding.
     *
     * @param liveEmbedding 512-d L2-normalized embedding from live face
     * @param enrolledEmbeddings All active enrolled embeddings grouped by staff
     * @param staffLookup Map of staffId → StaffEntity for name resolution
     * @return Match result with identity, distances, and margin check
     */
    fun findBestMatch(
        liveEmbedding: FloatArray,
        enrolledEmbeddings: Map<String, List<FaceEmbeddingEntity>>,
        staffLookup: Map<String, StaffEntity>
    ): MatchResult {
        if (enrolledEmbeddings.isEmpty()) {
            return MatchResult(
                matched = false,
                reason = "No enrolled staff found in database"
            )
        }

        // Evaluate all identities
        val evaluations = enrolledEmbeddings.map { (staffId, embeddings) ->
            val staff = staffLookup[staffId]
            var bestDistance = Float.MAX_VALUE
            var bestSampleIndex = -1

            embeddings.forEachIndexed { index, emb ->
                val distance = cosineDistance(liveEmbedding, emb.embedding)
                if (distance < bestDistance) {
                    bestDistance = distance
                    bestSampleIndex = index
                }
            }

            IdentityEvaluation(
                staffId = staffId,
                staffName = staff?.name ?: staffId,
                bestDistance = bestDistance,
                bestSampleIndex = bestSampleIndex,
                sampleCount = embeddings.size,
                isWithinThreshold = bestDistance <= BiometricConfig.FACE_MATCH_THRESHOLD
            )
        }.sortedBy { it.bestDistance }

        val best = evaluations.first()

        // Check if best match is within threshold
        if (!best.isWithinThreshold) {
            return MatchResult(
                matched = false,
                staffId = null,
                staffName = null,
                distance = best.bestDistance,
                secondBestDistance = evaluations.getOrNull(1)?.bestDistance,
                secondBestStaffName = evaluations.getOrNull(1)?.staffName,
                matchMargin = null,
                evaluations = evaluations,
                reason = "Face Not Recognized. Distance ${formatFloat(best.bestDistance)} exceeds threshold ${BiometricConfig.FACE_MATCH_THRESHOLD}"
            )
        }

        // Check margin over second-best (from different identity)
        val secondBest = evaluations.getOrNull(1)
        val margin = secondBest?.let { it.bestDistance - best.bestDistance }

        if (margin != null && margin < BiometricConfig.MIN_MATCH_MARGIN) {
            return MatchResult(
                matched = false,
                staffId = best.staffId,
                staffName = best.staffName,
                distance = best.bestDistance,
                secondBestDistance = secondBest.bestDistance,
                secondBestStaffName = secondBest.staffName,
                matchMargin = margin,
                evaluations = evaluations,
                reason = "Ambiguous match. Margin ${formatFloat(margin)} below minimum ${BiometricConfig.MIN_MATCH_MARGIN}"
            )
        }

        return MatchResult(
            matched = true,
            staffId = best.staffId,
            staffName = best.staffName,
            distance = best.bestDistance,
            secondBestDistance = secondBest?.bestDistance,
            secondBestStaffName = secondBest?.staffName,
            matchMargin = margin,
            evaluations = evaluations,
            reason = null
        )
    }

    companion object {
        /**
         * Cosine similarity between two L2-normalized vectors.
         * Since vectors are unit-normalized: similarity = dot product.
         */
        fun cosineSimilarity(v1: FloatArray, v2: FloatArray): Float {
            var dot = 0f
            val len = minOf(v1.size, v2.size)
            for (i in 0 until len) {
                dot += v1[i] * v2[i]
            }
            return dot
        }

        /**
         * Cosine distance: 1 - cosineSimilarity.
         */
        fun cosineDistance(v1: FloatArray, v2: FloatArray): Float {
            return 1f - cosineSimilarity(v1, v2)
        }

        private fun formatFloat(f: Float): String = "%.4f".format(f)
    }
}

data class IdentityEvaluation(
    val staffId: String,
    val staffName: String,
    val bestDistance: Float,
    val bestSampleIndex: Int,
    val sampleCount: Int,
    val isWithinThreshold: Boolean
)

data class MatchResult(
    val matched: Boolean,
    val staffId: String? = null,
    val staffName: String? = null,
    val distance: Float = Float.MAX_VALUE,
    val secondBestDistance: Float? = null,
    val secondBestStaffName: String? = null,
    val matchMargin: Float? = null,
    val evaluations: List<IdentityEvaluation> = emptyList(),
    val reason: String? = null
)
