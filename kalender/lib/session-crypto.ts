import { createHmac, timingSafeEqual } from "crypto";

export interface Principal {
  role: "admin" | "boss" | "member";
  id: string;
  name: string;
  departmentIds: string[];
}

export function signSession(principal: Principal, secret: string): string {
  const payload = Buffer.from(JSON.stringify(principal)).toString("base64url");
  const sig = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifySession(token: string, secret: string): Principal | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  const expected = createHmac("sha256", secret).update(payload).digest("base64url");
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString()) as Principal;
  } catch {
    return null;
  }
}
