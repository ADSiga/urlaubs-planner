import { createHmac, timingSafeEqual } from "crypto";

export interface Principal {
  role: "admin" | "boss" | "member";
  id: string;
  name: string;
  departmentIds: string[];
}

export interface SessionData {
  principal: Principal;
  iat: number; // ms epoch
  exp: number; // ms epoch
}

export const SESSION_TTL_MS = 60 * 60 * 24 * 1000; // 24h

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function signSession(principal: Principal, secret: string): string {
  const iat = Date.now();
  const body: SessionData = { principal, iat, exp: iat + SESSION_TTL_MS };
  const payload = Buffer.from(JSON.stringify(body)).toString("base64url");
  return `${payload}.${sign(payload, secret)}`;
}

export function verifySession(token: string, secret: string): SessionData | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  const expected = sign(payload, secret);
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }
  let body: unknown;
  try {
    body = JSON.parse(Buffer.from(payload, "base64url").toString());
  } catch {
    return null;
  }
  if (
    typeof body !== "object" ||
    body === null ||
    typeof (body as SessionData).iat !== "number" ||
    typeof (body as SessionData).exp !== "number" ||
    typeof (body as SessionData).principal !== "object" ||
    (body as SessionData).principal === null
  ) {
    return null; // rejects the old bare-principal format
  }
  const data = body as SessionData;
  if (Date.now() >= data.exp) return null;
  return data;
}

export function sessionPredatesPasswordChange(
  iat: number,
  passwordChangedAt: string | null
): boolean {
  if (!passwordChangedAt) return false;
  return iat < Date.parse(passwordChangedAt);
}
