import { createHmac, pbkdf2Sync, randomBytes, timingSafeEqual } from "node:crypto";
import { getStoredConfigValue, setConfigValue } from "./config";
import { get, run } from "./db";

export type AdminUser = {
  id: string;
  email: string;
  password_hash: string;
  salt: string;
  created_at: string;
  updated_at: string;
};

export type PublicAdminUser = {
  id: string;
  email: string;
};

export type AuthConfig = {
  sessionSecret: string;
  sessionCookieName: string;
  sessionTtlSeconds: number;
  rememberSessionTtlSeconds: number;
};

export function getAuthConfig(): AuthConfig {
  return {
    sessionSecret: getSessionSecret(),
    sessionCookieName: "local_seo_session",
    sessionTtlSeconds: Number(process.env.AUTH_SESSION_TTL_SECONDS || 60 * 60 * 24 * 7),
    rememberSessionTtlSeconds: Number(
      process.env.AUTH_SESSION_REMEMBER_TTL_SECONDS || 60 * 60 * 24 * 30,
    ),
  };
}

function getSessionSecret() {
  const stored = getStoredConfigValue("auth_session_secret");
  if (stored) return stored;

  const sessionSecret = randomBytes(32).toString("hex");
  setConfigValue("auth_session_secret", sessionSecret);
  return sessionSecret;
}

export function publicUser(user: AdminUser): PublicAdminUser {
  return { id: user.id, email: user.email };
}

export function getAdminUserCount(): number {
  const row = get<{ count: number }>("SELECT count(*) AS count FROM admin_users");
  return Number(row?.count || 0);
}

export function getAdminByEmail(email: string): AdminUser | undefined {
  return get<AdminUser>("SELECT * FROM admin_users WHERE lower(email) = lower(?)", [
    email.trim(),
  ]);
}

export function getAdminById(id: string): AdminUser | undefined {
  return get<AdminUser>("SELECT * FROM admin_users WHERE id = ?", [id]);
}

export function hashPassword(password: string, salt = randomBytes(16).toString("hex")) {
  const hash = pbkdf2Sync(password, salt, 210_000, 32, "sha256").toString("hex");
  return { salt, hash };
}

export function verifyPassword(user: AdminUser, password: string): boolean {
  const { hash } = hashPassword(password, user.salt);
  const expected = Buffer.from(user.password_hash, "hex");
  const actual = Buffer.from(hash, "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function createOrReplaceAdmin(email: string, password: string): PublicAdminUser {
  const normalizedEmail = email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalizedEmail)) {
    throw new Error("A valid email is required.");
  }
  if (password.length < 10) {
    throw new Error("Password must be at least 10 characters.");
  }
  const id = "local-admin";
  const { salt, hash } = hashPassword(password);
  run(
    `
    INSERT INTO admin_users (id, email, password_hash, salt, updated_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET
      email = excluded.email,
      password_hash = excluded.password_hash,
      salt = excluded.salt,
      updated_at = CURRENT_TIMESTAMP
    `,
    [id, normalizedEmail, hash, salt],
  );
  const user = getAdminById(id);
  if (!user) throw new Error("Failed to save admin user.");
  return publicUser(user);
}

export function createSessionToken(
  userId: string,
  config = getAuthConfig(),
  ttlSeconds = config.sessionTtlSeconds,
): string {
  const payload = Buffer.from(
    JSON.stringify({ uid: userId, exp: Date.now() + ttlSeconds * 1000 }),
  ).toString("base64url");
  const signature = createHmac("sha256", config.sessionSecret)
    .update(payload)
    .digest("base64url");
  return `${payload}.${signature}`;
}

export function verifySessionToken(
  token: string | undefined,
  config = getAuthConfig(),
): string | null {
  if (!token) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expected = createHmac("sha256", config.sessionSecret)
    .update(payload)
    .digest("base64url");
  const expectedBuf = Buffer.from(expected);
  const signatureBuf = Buffer.from(signature);
  if (
    expectedBuf.length !== signatureBuf.length ||
    !timingSafeEqual(expectedBuf, signatureBuf)
  ) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      uid?: string;
      exp?: number;
    };
    if (!parsed.uid || !parsed.exp || parsed.exp < Date.now()) return null;
    return parsed.uid;
  } catch {
    return null;
  }
}
