import crypto from "crypto";

export function genId(prefix: string): string {
  const rand = crypto.randomBytes(12).toString("base64url");
  return `${prefix}_${rand}`;
}

export function genApiKey(): string {
  return `bp_${crypto.randomBytes(24).toString("base64url")}`;
}

export function genSecret(): string {
  return crypto.randomBytes(48).toString("base64url");
}

export function hmacSign(payload: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}
