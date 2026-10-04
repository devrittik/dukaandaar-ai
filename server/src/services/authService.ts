import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import type { StoredAuthSession, StoredUserAccount, StorageAdapter } from "../storage/StorageAdapter.js";

const PASSWORD_KEY_BYTES = 64;
const SESSION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

export interface AuthPrincipal {
  id: string;
  email: string;
  ownerName: string;
  shopId: string;
  shopName: string;
}

export type PublicAuthUser = Omit<AuthPrincipal, "shopId">;

export interface SessionGrant {
  token: string;
  expiresAt: Date;
  user: AuthPrincipal;
}

export class AuthError extends Error {
  constructor(message: string, readonly statusCode: number) {
    super(message);
    this.name = "AuthError";
  }
}

function normalizedEmail(email: string): string {
  return email.trim().toLowerCase();
}

function derivePasswordKey(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, PASSWORD_KEY_BYTES, { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) => {
      if (error) reject(error);
      else resolve(key as Buffer);
    });
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derivePasswordKey(password, salt);
  return `${salt.toString("hex")}:${key.toString("hex")}`;
}

export async function verifyPassword(password: string, savedHash: string): Promise<boolean> {
  const [saltHex, keyHex, extra] = savedHash.split(":");
  if (extra !== undefined || !/^[a-f\d]{32}$/iu.test(saltHex ?? "") || !/^[a-f\d]{128}$/iu.test(keyHex ?? "")) return false;
  const expected = Buffer.from(keyHex, "hex");
  const actual = await derivePasswordKey(password, Buffer.from(saltHex, "hex"));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function toPublicAuthUser(user: AuthPrincipal): PublicAuthUser {
  return { id: user.id, email: user.email, ownerName: user.ownerName, shopName: user.shopName };
}

export class AuthService {
  constructor(private readonly storage: StorageAdapter) {}

  async register(input: { ownerName: string; shopName: string; email: string; password: string }): Promise<SessionGrant> {
    const email = normalizedEmail(input.email);
    const user: StoredUserAccount = {
      id: `user_${randomUUID()}`,
      email,
      passwordHash: await hashPassword(input.password),
      ownerName: input.ownerName.trim(),
      shopId: `shop_${randomUUID()}`,
      createdAt: new Date().toISOString(),
    };

    try {
      await this.storage.createUser(user);
    } catch (error) {
      if (error instanceof Error && /already registered|duplicate key/i.test(error.message)) {
        throw new AuthError("An account with this email already exists.", 409);
      }
      throw error;
    }

    try {
      const settings = await this.storage.updateSettings(user.shopId, {
        shopName: input.shopName.trim(),
        ownerName: user.ownerName,
        phone: "",
        address: "",
        lowStockDefaultThreshold: 10,
      });
      const grant = await this.createSession(user.id);
      return {
        ...grant,
        user: { id: user.id, email: user.email, ownerName: user.ownerName, shopId: user.shopId, shopName: settings.shopName },
      };
    } catch (error) {
      await this.storage.deleteUserById(user.id).catch(() => undefined);
      throw error;
    }
  }

  async login(emailValue: string, password: string): Promise<SessionGrant> {
    const user = await this.storage.findUserByEmail(normalizedEmail(emailValue));
    if (!user || !await verifyPassword(password, user.passwordHash)) {
      throw new AuthError("Invalid email or password.", 401);
    }
    const settings = await this.storage.getSettings(user.shopId);
    const grant = await this.createSession(user.id);
    return {
      ...grant,
      user: { id: user.id, email: user.email, ownerName: user.ownerName, shopId: user.shopId, shopName: settings.shopName },
    };
  }

  async authenticate(token: string | null | undefined): Promise<AuthPrincipal | null> {
    if (!token) return null;
    const tokenHash = hashSessionToken(token);
    const session = await this.storage.findAuthSessionByTokenHash(tokenHash);
    if (!session) return null;
    if (session.expiresAt.getTime() <= Date.now()) {
      await this.storage.deleteAuthSessionByTokenHash(tokenHash);
      return null;
    }
    const user = await this.storage.findUserById(session.userId);
    if (!user) {
      await this.storage.deleteAuthSessionByTokenHash(tokenHash);
      return null;
    }
    const settings = await this.storage.getSettings(user.shopId);
    return { id: user.id, email: user.email, ownerName: user.ownerName, shopId: user.shopId, shopName: settings.shopName };
  }

  async logout(token: string | null | undefined): Promise<void> {
    if (token) await this.storage.deleteAuthSessionByTokenHash(hashSessionToken(token));
  }

  private async createSession(userId: string): Promise<Omit<SessionGrant, "user">> {
    const token = randomBytes(32).toString("base64url");
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + SESSION_LIFETIME_MS);
    const session: StoredAuthSession = {
      id: `session_${randomUUID()}`,
      userId,
      tokenHash: hashSessionToken(token),
      createdAt: createdAt.toISOString(),
      expiresAt,
    };
    await this.storage.createAuthSession(session);
    return { token, expiresAt };
  }
}
