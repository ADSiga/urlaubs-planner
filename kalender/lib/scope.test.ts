import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isAdminPrincipal,
  canManageDepartmentScope,
  canManageMemberScope,
} from "./scope.ts";
import type { Principal } from "./session-crypto.ts";

const admin: Principal = { role: "admin", id: "admin", name: "Admin", departmentIds: [] };
const boss: Principal = { role: "boss", id: "b1", name: "Anna", departmentIds: ["d1", "d2"] };
const member: Principal = { role: "member", id: "u1", name: "Tom", departmentIds: ["d1"] };

test("isAdminPrincipal", () => {
  assert.equal(isAdminPrincipal(admin), true);
  assert.equal(isAdminPrincipal(boss), false);
  assert.equal(isAdminPrincipal(null), false);
});

test("canManageDepartmentScope: admin all, boss own only, member never", () => {
  assert.equal(canManageDepartmentScope(admin, "dX"), true);
  assert.equal(canManageDepartmentScope(boss, "d1"), true);
  assert.equal(canManageDepartmentScope(boss, "dX"), false);
  assert.equal(canManageDepartmentScope(member, "d1"), false);
  assert.equal(canManageDepartmentScope(null, "d1"), false);
});

test("canManageMemberScope: boss needs an overlapping department", () => {
  assert.equal(canManageMemberScope(admin, ["dX"]), true);
  assert.equal(canManageMemberScope(boss, ["d2", "d9"]), true);
  assert.equal(canManageMemberScope(boss, ["d9"]), false);
  assert.equal(canManageMemberScope(boss, []), false);
  assert.equal(canManageMemberScope(member, ["d1"]), false);
});
