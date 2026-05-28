/**
 * Cryptographically random URL-safe slugs for public upload links.
 * 16 chars from a 62-char alphabet = ~95 bits of entropy, far beyond
 * any brute-force risk.
 */
import { customAlphabet } from "nanoid";
import { createHash } from "crypto";
import { coreEnv } from "@/lib/env";

const ALPHABET =
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

const generate = customAlphabet(ALPHABET, 16);

export function generateSlug(): string {
  return generate();
}

/**
 * Hash a public uploader's IP for rate-limit keying without storing
 * the raw IP. Salted with the encryption key so two installs produce
 * different hashes for the same IP.
 */
export function hashIp(ip: string): string {
  const salt = coreEnv().TOKEN_ENCRYPTION_KEY;
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex");
}
