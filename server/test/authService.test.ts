import assert from "node:assert/strict";
import { test } from "node:test";
import { getDashboard } from "../src/services/analyticsService.js";
import { AuthError, AuthService } from "../src/services/authService.js";
import { InMemoryAdapter } from "../src/storage/InMemoryAdapter.js";

test("signup creates a private empty shop and an opaque revocable session", async () => {
  const storage = new InMemoryAdapter();
  const auth = new AuthService(storage);
  const grant = await auth.register({
    ownerName: "Asha Sen",
    shopName: "Sen General Store",
    email: "  ASHA@example.com ",
    password: "a-long-test-password",
  });

  assert.equal(grant.user.email, "asha@example.com");
  assert.equal(grant.user.shopName, "Sen General Store");
  assert.ok(grant.token.length >= 40);
  assert.equal((await auth.authenticate(grant.token))?.shopId, grant.user.shopId);

  const stored = await storage.findUserByEmail("asha@example.com");
  assert.ok(stored);
  assert.notEqual(stored.passwordHash, "a-long-test-password");
  assert.ok(stored.passwordHash.includes(":"));

  const dashboard = await getDashboard(storage, grant.user.shopId);
  assert.equal(dashboard.shop.name, "Sen General Store");
  assert.equal(dashboard.counts.products, 0);
  assert.equal(dashboard.counts.transactionsToday, 0);

  await auth.logout(grant.token);
  assert.equal(await auth.authenticate(grant.token), null);
});

test("different registrations receive isolated shop IDs; login normalizes email", async () => {
  const storage = new InMemoryAdapter();
  const auth = new AuthService(storage);
  const first = await auth.register({ ownerName: "First Owner", shopName: "First Shop", email: "first@example.com", password: "first-password" });
  const second = await auth.register({ ownerName: "Second Owner", shopName: "Second Shop", email: "second@example.com", password: "second-password" });

  assert.notEqual(first.user.shopId, second.user.shopId);
  const login = await auth.login(" FIRST@EXAMPLE.COM ", "first-password");
  assert.equal(login.user.shopId, first.user.shopId);
  assert.equal(login.user.shopName, "First Shop");
});

test("signup rejects duplicate emails and login errors do not disclose account existence", async () => {
  const auth = new AuthService(new InMemoryAdapter());
  await auth.register({ ownerName: "Asha", shopName: "Asha Shop", email: "asha@example.com", password: "a-long-test-password" });

  await assert.rejects(
    () => auth.register({ ownerName: "Another", shopName: "Another Shop", email: "ASHA@example.com", password: "another-password" }),
    (error: unknown) => error instanceof AuthError && error.statusCode === 409,
  );
  await assert.rejects(
    () => auth.login("missing@example.com", "wrong-password"),
    (error: unknown) => error instanceof AuthError && error.statusCode === 401 && error.message === "Invalid email or password.",
  );
  await assert.rejects(
    () => auth.login("asha@example.com", "wrong-password"),
    (error: unknown) => error instanceof AuthError && error.statusCode === 401 && error.message === "Invalid email or password.",
  );
});
