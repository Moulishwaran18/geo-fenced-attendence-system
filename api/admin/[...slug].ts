/**
 * Vercel Serverless Function: /api/admin/[...slug]
 *
 * Catches all dynamic admin subroutes:
 * - /api/admin/staff/:id
 * - /api/admin/staff/:id/enroll (and /face-enrollment)
 * - /api/admin/staff/:id/status
 * - /api/admin/staff/:id/embedding/:embeddingId
 * - /api/admin/db-diagnostic
 */

import handler from "./staff.ts";

export default handler;
