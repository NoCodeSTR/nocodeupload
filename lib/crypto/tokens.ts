/**
 * AES-256-GCM encryption for OAuth tokens at rest.
 *
 * Each ciphertext stores its own random 12-byte IV and 16-byte auth tag,
 * persisted alongside the ciphertext in the database. The encryption key is
 * loaded from TOKEN_ENCRYPTION_KEY (64 hex chars / 32 bytes).
 *
 * Generate a key with:
 *   node scripts/generate-key.js
 * or:
 *   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 *
 * IMPORTANT: rotating the key invalidates all stored refresh tokens — users
 * would need to reconnect Google. Treat as a long-lived secret.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import { coreEnv } from "@/lib/env";

const ALGO = "aes-256-gcm";

function getKey(): Buffer {
  return Buffer.from(coreEnv().TOKEN_ENCRYPTION_KEY, "hex");
}

export interface EncryptedBlob {
  ciphertext: string; // base64
  iv: string; // base64
  authTag: string; // base64
}

export function encryptString(plaintext: string): EncryptedBlob {
  const key = getKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    ciphertext: enc.toString("base64"),
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
  };
}

export function decryptString(blob: EncryptedBlob): string {
  const key = getKey();
  const iv = Buffer.from(blob.iv, "base64");
  const authTag = Buffer.from(blob.authTag, "base64");
  const ciphertext = Buffer.from(blob.ciphertext, "base64");
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(authTag);
  const dec = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return dec.toString("utf8");
}

/**
 * Encrypt a string into a single compact, URL-safe token (the three blob
 * parts joined and base64url-encoded). Used to hand the browser an opaque
 * handle (e.g. a resumable session URL) it can echo back without being able
 * to read or tamper with it.
 */
export function encryptToToken(plaintext: string): string {
  const blob = encryptString(plaintext);
  const packed = JSON.stringify(blob);
  return Buffer.from(packed, "utf8").toString("base64url");
}

/** Inverse of encryptToToken. Throws if the token is malformed or tampered. */
export function decryptFromToken(token: string): string {
  const packed = Buffer.from(token, "base64url").toString("utf8");
  const blob = JSON.parse(packed) as EncryptedBlob;
  return decryptString(blob);
}
