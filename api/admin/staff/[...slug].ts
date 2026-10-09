/**
 * Vercel Serverless Function: /api/admin/staff/[...slug]
 *
 * Catches dynamic staff subroutes:
 * - /api/admin/staff/:id
 * - /api/admin/staff/:id/enroll (and /face-enrollment)
 * - /api/admin/staff/:id/status
 * - /api/admin/staff/:id/embedding/:embeddingId
 */

import handler from "./index.ts";

export default handler;
