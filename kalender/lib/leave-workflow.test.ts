import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeInitialStatus,
  canSubstituteAct,
  canResubmit,
  STATUS_LABELS,
} from "./leave-workflow.ts";

test("member + Erholungsurlaub with substitute is gated", () => {
  assert.equal(
    computeInitialStatus({ role: "member", leaveType: "Erholungsurlaub", requireSubstitute: false, hasSubstitute: true }),
    "WARTE_VERTRETUNG"
  );
});

test("member + Sonderurlaub goes straight to PENDING", () => {
  assert.equal(
    computeInitialStatus({ role: "member", leaveType: "Sonderurlaub", requireSubstitute: false, hasSubstitute: true }),
    "PENDING"
  );
});

test("member + Erholungsurlaub without a substitute cannot be gated", () => {
  assert.equal(
    computeInitialStatus({ role: "member", leaveType: "Erholungsurlaub", requireSubstitute: false, hasSubstitute: false }),
    "PENDING"
  );
});

test("staff defaults to PENDING when checkbox is off", () => {
  assert.equal(
    computeInitialStatus({ role: "boss", leaveType: "Erholungsurlaub", requireSubstitute: false, hasSubstitute: true }),
    "PENDING"
  );
  assert.equal(
    computeInitialStatus({ role: "admin", leaveType: "Erholungsurlaub", requireSubstitute: false, hasSubstitute: true }),
    "PENDING"
  );
});

test("staff gates when checkbox is on and a substitute is chosen (any leave type)", () => {
  assert.equal(
    computeInitialStatus({ role: "admin", leaveType: "Sonderurlaub", requireSubstitute: true, hasSubstitute: true }),
    "WARTE_VERTRETUNG"
  );
});

test("staff checkbox on but no substitute falls back to PENDING", () => {
  assert.equal(
    computeInitialStatus({ role: "boss", leaveType: "Erholungsurlaub", requireSubstitute: true, hasSubstitute: false }),
    "PENDING"
  );
});

test("canSubstituteAct only on WARTE_VERTRETUNG", () => {
  assert.equal(canSubstituteAct("WARTE_VERTRETUNG"), true);
  assert.equal(canSubstituteAct("PENDING"), false);
  assert.equal(canSubstituteAct("GENEHMIGT"), false);
  assert.equal(canSubstituteAct("ABGELEHNT_VERTRETUNG"), false);
});

test("canResubmit only on ABGELEHNT_VERTRETUNG", () => {
  assert.equal(canResubmit("ABGELEHNT_VERTRETUNG"), true);
  assert.equal(canResubmit("WARTE_VERTRETUNG"), false);
  assert.equal(canResubmit("PENDING"), false);
});

test("STATUS_LABELS maps all four statuses to German", () => {
  assert.equal(STATUS_LABELS.WARTE_VERTRETUNG, "Wartet auf Vertretung");
  assert.equal(STATUS_LABELS.ABGELEHNT_VERTRETUNG, "Vertretung abgelehnt");
  assert.equal(STATUS_LABELS.PENDING, "Ausstehend");
  assert.equal(STATUS_LABELS.GENEHMIGT, "Genehmigt");
});
