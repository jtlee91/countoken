import { createHash, timingSafeEqual } from "node:crypto";

export function hashIngestCredential(credential: string, pepper: string) {
  return createHash("sha256")
    .update(`${pepper}:${credential}`)
    .digest("hex");
}

export function safeHashEquals(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.byteLength !== rightBuffer.byteLength) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}
