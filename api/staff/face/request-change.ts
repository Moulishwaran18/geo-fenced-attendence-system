/**
 * Dedicated Vercel Serverless Function: POST /api/staff/face/request-change
 */
import staffFaceHandler from "./index.ts";

export default async function handler(req: any, res?: any) {
  req.url = "/api/staff/face/request-change";
  return staffFaceHandler(req, res);
}
