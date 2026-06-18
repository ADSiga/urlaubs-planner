import { randomBytes } from "crypto";

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function generateBase32Secret(bytes = 20): string {
  const buf = randomBytes(bytes);
  let bits = "";
  for (const b of buf) bits += b.toString(2).padStart(8, "0");
  let out = "";
  for (let i = 0; i + 5 <= bits.length; i += 5) {
    out += BASE32[parseInt(bits.slice(i, i + 5), 2)];
  }
  return out;
}

export function buildOtpauthUrl(
  label: string,
  secret: string,
  issuer = "Urlaubs-Planer"
): string {
  const iss = encodeURIComponent(issuer);
  return `otpauth://totp/${iss}:${encodeURIComponent(label)}?secret=${secret}&issuer=${iss}`;
}
