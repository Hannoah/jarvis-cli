import assert from "node:assert/strict";
import { test } from "node:test";
import { installPlan } from "../src/clis.js";
import { catalog } from "../src/tools/enterprise.js";

test("installPlan: package-manager one-liners are automatic, everything else is a human instruction", () => {
  const c = catalog("C:/Users/x");
  assert.ok(["kubectl", "az", "pac", "git", "devtunnel", "sas-viya", "pangpcli", "sh"].every((k) => k in c));
  assert.equal(installPlan(c["sas-viya"]!), null);
  assert.equal(installPlan(c.pangpcli!), null); // comes with the organisation's GlobalProtect deployment
  const plan = installPlan({ ...c.kubectl!, install: "winget install -e --id Kubernetes.kubectl" })!;
  assert.deepEqual(plan.args, ["install", "-e", "--id", "Kubernetes.kubectl", "--accept-source-agreements", "--accept-package-agreements"]);
  const brew = installPlan({ ...c.kubectl!, install: "brew install kubectl" })!;
  assert.deepEqual([brew.file, brew.args], ["brew", ["install", "kubectl"]]);
  assert.equal(installPlan({ ...c.kubectl!, install: "curl -sL https://x | bash" }), null); // never pipe a download into a shell on the user's behalf
});
