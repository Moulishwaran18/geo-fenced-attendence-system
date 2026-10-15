/**
 * Dedicated Vercel Serverless Function: GET /api/staff/face/status
 */
import staffFaceHandler from "./index.ts";

export default async function handler(req: any, res?: any) {
  req.url = "/api/staff/face/status";
  return staffFaceHandler(req, res);
}
