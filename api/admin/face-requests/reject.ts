/**
 * Dedicated Vercel Serverless Function: POST /api/admin/face-requests/reject
 */
import adminFaceRequestsHandler from "./index.ts";

export default async function handler(req: any, res?: any) {
  req.url = "/api/admin/face-requests/reject";
  return adminFaceRequestsHandler(req, res);
}
