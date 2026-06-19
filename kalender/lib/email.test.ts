import { test } from "node:test";
import assert from "node:assert/strict";
import { buildResetEmail } from "./email.ts";

test("buildResetEmail includes the reset URL and a German subject", () => {
  const url = "https://example.com/reset/abc123";
  const { subject, text } = buildResetEmail(url);
  assert.ok(subject.length > 0);
  assert.match(subject, /[Pp]asswort/);
  assert.ok(text.includes(url));
});
