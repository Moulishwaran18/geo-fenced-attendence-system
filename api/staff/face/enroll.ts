/**
 * Dedicated Vercel Serverless Function: POST /api/staff/face/enroll
 */
import staffFaceHandler from "./index.ts";

export default async function handler(req: any, res?: any) {
  req.url = "/api/staff/face/enroll";
  return staffFaceHandler(req, res);
}
