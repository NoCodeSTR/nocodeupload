#!/usr/bin/env node
/**
 * Generate a TOKEN_ENCRYPTION_KEY suitable for AES-256-GCM.
 * Usage: node scripts/generate-key.js
 */
const { randomBytes } = require("crypto");
const key = randomBytes(32).toString("hex");
console.log("");
console.log("Add this to .env.local (and to Vercel env vars for prod):");
console.log("");
console.log(`TOKEN_ENCRYPTION_KEY=${key}`);
console.log("");
console.log("WARNING: rotating this key invalidates all stored refresh tokens.");
console.log("Treat it as a long-lived secret.");
console.log("");
