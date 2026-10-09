/**
 * Vercel Serverless Function: POST /api/face/verify
 *
 * Biometric Face Verification endpoint for CampusAttend.
 * Matches 512-D ArcFace descriptors against enrolled database.
 */

import handler from "../../src/server/api/face-search-handler.ts";

export default handler;
