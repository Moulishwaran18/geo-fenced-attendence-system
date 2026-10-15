package com.campusattend.biometric.liveness

/**
 * Challenge types and generation for randomized active head-movement liveness verification.
 *
 * Port of: src/lib/face-recognition/liveness-engine.ts
 *
 * Removes blink-based requirements and generates fresh sequences of 3 randomized
 * directional head movements (LEFT, RIGHT, UP, DOWN, and return to CENTER).
 */

enum class ChallengeCategory {
    RANDOMIZED_HEAD_MOVEMENT,
    TURN_LEFT,
    TURN_RIGHT,
    LOOK_UP,
    LOOK_DOWN
}

enum class StepType {
    POSE
}

data class ChallengeStep(
    val id: String,
    val type: StepType,
    val instruction: String,
    val targetDirection: HeadDirection,
    val movementIndex: Int,
    val totalMovements: Int = 3,
    val isReturnToCenter: Boolean = false,
    var completed: Boolean = false
)

data class GeneratedChallenge(
    val category: ChallengeCategory,
    val name: String,
    val steps: List<ChallengeStep>
)

private val SUPPORTED_DIRECTIONS = listOf(
    HeadDirection.LEFT,
    HeadDirection.RIGHT,
    HeadDirection.UP,
    HeadDirection.DOWN
)

/**
 * Generate a sequence of 3 randomized directional movements without consecutive duplicates.
 */
fun generateRandomDirectionSequence(count: Int = 3): List<HeadDirection> {
    val sequence = mutableListOf<HeadDirection>()
    var lastDir: HeadDirection? = null

    for (i in 0 until count) {
        val available = SUPPORTED_DIRECTIONS.filter { it != lastDir }
        val chosen = available.random()
        sequence.add(chosen)
        lastDir = chosen
    }

    return sequence
}

private fun getDirectionInstruction(direction: HeadDirection, movementIndex: Int, total: Int): String {
    return when (direction) {
        HeadDirection.LEFT -> "Movement $movementIndex of $total: Turn your head LEFT"
        HeadDirection.RIGHT -> "Movement $movementIndex of $total: Turn your head RIGHT"
        HeadDirection.UP -> "Movement $movementIndex of $total: Tilt your head UP"
        HeadDirection.DOWN -> "Movement $movementIndex of $total: Tilt your head DOWN"
        HeadDirection.CENTER -> "Return your head to CENTER"
    }
}

/**
 * Generate a fresh randomized 3-movement challenge interleaved with return-to-center.
 */
fun generateRandomChallenge(preferredCategory: ChallengeCategory? = null): GeneratedChallenge {
    val sequence = generateRandomDirectionSequence(3)
    val steps = mutableListOf<ChallengeStep>()

    for (i in sequence.indices) {
        val dir = sequence[i]
        val movementIndex = i + 1

        steps.add(
            ChallengeStep(
                id = "step-$movementIndex-move",
                type = StepType.POSE,
                instruction = getDirectionInstruction(dir, movementIndex, sequence.size),
                targetDirection = dir,
                movementIndex = movementIndex,
                totalMovements = sequence.size,
                isReturnToCenter = false
            )
        )

        // Interleave return to center between movements
        if (i < sequence.size - 1) {
            steps.add(
                ChallengeStep(
                    id = "step-$movementIndex-center",
                    type = StepType.POSE,
                    instruction = "Return your head to CENTER",
                    targetDirection = HeadDirection.CENTER,
                    movementIndex = movementIndex,
                    totalMovements = sequence.size,
                    isReturnToCenter = true
                )
            )
        }
    }

    return GeneratedChallenge(
        category = preferredCategory ?: ChallengeCategory.RANDOMIZED_HEAD_MOVEMENT,
        name = "Randomized Head-Movement Challenge",
        steps = steps
    )
}
