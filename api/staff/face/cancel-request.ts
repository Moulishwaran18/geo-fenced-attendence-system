/**
 * Dedicated Vercel Serverless Function: POST /api/staff/face/cancel-request
 */
import staffFaceHandler from "./index.ts";

export default async function handler(req: any, res?: any) {
  req.url = "/api/staff/face/cancel-request";
  return staffFaceHandler(req, res);
}
