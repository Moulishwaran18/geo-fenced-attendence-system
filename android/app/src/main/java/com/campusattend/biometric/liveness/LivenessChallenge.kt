package com.campusattend.biometric.liveness

/**
 * Challenge types and generation for randomized active liveness verification.
 *
 * Port of: src/lib/face-recognition/liveness-engine.ts (challenge definitions)
 *
 * 8 possible challenge types ensure that prerecorded videos or static images
 * cannot pass verification without performing the specific requested action.
 */

enum class ChallengeCategory {
    BLINK_ONCE,
    BLINK_TWICE,
    TURN_LEFT,
    TURN_RIGHT,
    LOOK_UP,
    LOOK_DOWN,
    BLINK_THEN_TURN_LEFT,
    BLINK_THEN_TURN_RIGHT
}

enum class StepType {
    BLINK,
    POSE
}

data class ChallengeStep(
    val id: String,
    val type: StepType,
    val instruction: String,
    val targetBlinks: Int? = null,
    val targetDirection: HeadDirection? = null,
    var completed: Boolean = false
)

data class GeneratedChallenge(
    val category: ChallengeCategory,
    val name: String,
    val steps: List<ChallengeStep>
)

/**
 * Generate a random liveness challenge from the pool.
 * Each verification session gets a fresh, unpredictable challenge.
 */
fun generateRandomChallenge(preferredCategory: ChallengeCategory? = null): GeneratedChallenge {
    val category = preferredCategory ?: ChallengeCategory.entries.random()

    return when (category) {
        ChallengeCategory.BLINK_ONCE -> GeneratedChallenge(
            category = category,
            name = "Single Blink",
            steps = listOf(
                ChallengeStep(
                    id = "s1",
                    type = StepType.BLINK,
                    instruction = "Hold still & blink your eyes once to verify",
                    targetBlinks = 1
                )
            )
        )

        ChallengeCategory.BLINK_TWICE -> GeneratedChallenge(
            category = category,
            name = "Double Blink",
            steps = listOf(
                ChallengeStep(
                    id = "s1",
                    type = StepType.BLINK,
                    instruction = "Please blink twice.",
                    targetBlinks = 2
                )
            )
        )

        ChallengeCategory.TURN_LEFT -> GeneratedChallenge(
            category = category,
            name = "Turn Left",
            steps = listOf(
                ChallengeStep(
                    id = "s1",
                    type = StepType.POSE,
                    instruction = "Please turn your head slightly left.",
                    targetDirection = HeadDirection.LEFT
                )
            )
        )

        ChallengeCategory.TURN_RIGHT -> GeneratedChallenge(
            category = category,
            name = "Turn Right",
            steps = listOf(
                ChallengeStep(
                    id = "s1",
                    type = StepType.POSE,
                    instruction = "Please turn your head slightly right.",
                    targetDirection = HeadDirection.RIGHT
                )
            )
        )

        ChallengeCategory.LOOK_UP -> GeneratedChallenge(
            category = category,
            name = "Look Up",
            steps = listOf(
                ChallengeStep(
                    id = "s1",
                    type = StepType.POSE,
                    instruction = "Please look slightly up.",
                    targetDirection = HeadDirection.UP
                )
            )
        )

        ChallengeCategory.LOOK_DOWN -> GeneratedChallenge(
            category = category,
            name = "Look Down",
            steps = listOf(
                ChallengeStep(
                    id = "s1",
                    type = StepType.POSE,
                    instruction = "Please look slightly down.",
                    targetDirection = HeadDirection.DOWN
                )
            )
        )

        ChallengeCategory.BLINK_THEN_TURN_LEFT -> GeneratedChallenge(
            category = category,
            name = "Blink then Turn Left",
            steps = listOf(
                ChallengeStep(
                    id = "s1",
                    type = StepType.BLINK,
                    instruction = "Step 1/2: Please blink once.",
                    targetBlinks = 1
                ),
                ChallengeStep(
                    id = "s2",
                    type = StepType.POSE,
                    instruction = "Step 2/2: Please turn your head slightly left.",
                    targetDirection = HeadDirection.LEFT
                )
            )
        )

        ChallengeCategory.BLINK_THEN_TURN_RIGHT -> GeneratedChallenge(
            category = category,
            name = "Blink then Turn Right",
            steps = listOf(
                ChallengeStep(
                    id = "s1",
                    type = StepType.BLINK,
                    instruction = "Step 1/2: Please blink once.",
                    targetBlinks = 1
                ),
                ChallengeStep(
                    id = "s2",
                    type = StepType.POSE,
                    instruction = "Step 2/2: Please turn your head slightly right.",
                    targetDirection = HeadDirection.RIGHT
                )
            )
        )
    }
}
