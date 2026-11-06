import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { checkForUpdate, isNewer, launchNotice, readState, saveState } from "../src/update.js";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-upd-"));
const DAY = 86_400_000;

test("isNewer compares x.y.z numerically", () => {
  assert.ok(isNewer("0.7.0", "0.6.1"));
  assert.ok(isNewer("0.10.0", "0.9.9")); // not a string comparison
  assert.ok(isNewer("1.0.0", "0.99.99"));
  assert.ok(!isNewer("0.6.1", "0.6.1"));
  assert.ok(!isNewer("0.6.0", "0.6.1"));
});

test("checkForUpdate: asks GitHub once a day; Skip and Later are remembered; failures and old versions offer nothing", async () => {
  const dir = tmp();
  let calls = 0;
  const latest = (v: string | null) => async () => (calls++, v);
  const t0 = 1_000_000_000_000;

  assert.equal(await checkForUpdate(dir, "0.6.1", t0, latest("0.7.0")), "0.7.0");
  assert.equal(await checkForUpdate(dir, "0.6.1", t0 + 1000, latest("0.9.9")), "0.7.0"); // cached: no second request
  assert.equal(calls, 1);

  saveState(dir, { snoozeUntil: t0 + DAY }); // "Later"
  assert.equal(await checkForUpdate(dir, "0.6.1", t0 + 2000, latest("0.7.0")), null);
  assert.equal(await checkForUpdate(dir, "0.6.1", t0 + DAY - 1, latest("0.7.0")), null);
  assert.equal(await checkForUpdate(dir, "0.6.1", t0 + DAY + 1, latest("0.7.0")), "0.7.0"); // a day later: asks again, and checks again
  assert.equal(calls, 2);

  saveState(dir, { skipped: "0.7.0" }); // "Skip 0.7.0"
  assert.equal(await checkForUpdate(dir, "0.6.1", t0 + 3 * DAY, latest("0.7.0")), null);
  assert.equal(await checkForUpdate(dir, "0.6.1", t0 + 5 * DAY, latest("0.8.0")), "0.8.0"); // a newer release is offered again

  assert.equal(await checkForUpdate(tmp(), "0.6.1", t0, latest(null)), null); // offline
  assert.equal(await checkForUpdate(tmp(), "0.7.0", t0, latest("0.7.0")), null); // already current
});

test("launchNotice: welcome on a fresh install, what's new after an update, silent otherwise, once per version", () => {
  const o = { hadSettings: false, settingsDir: "~/.jarvis", serverUp: false };
  const dir = tmp();
  const fresh = launchNotice(dir, "0.7.0", o)!;
  assert.match(fresh.join("\n"), /Jarvis 0\.7\.0 is installed/);
  assert.equal(launchNotice(dir, "0.7.0", o), null); // already announced

  const up = launchNotice(dir, "0.7.1", { ...o, serverUp: true })!.join("\n");
  assert.match(up, /updated 0\.7\.0 → 0\.7\.1/);
  assert.match(up, /releases\/tag\/v0\.7\.1/);
  assert.match(up, /still running the old version/); // a running server keeps the old code

  const existing = launchNotice(tmp(), "0.7.0", { ...o, hadSettings: true })!.join("\n"); // upgraded from a version without this notice
  assert.match(existing, /Jarvis 0\.7\.0 is ready/);
  assert.equal(readState(dir).seenVersion, "0.7.1");
});

test("shouldAskAboutUpdate: only a person at a terminal is asked, never scripts, agents or the server", async () => {
  const { shouldAskAboutUpdate } = await import("../src/update.js");
  const base = { cmd: "read_file", interactive: true, machine: false, disabled: false };
  assert.equal(shouldAskAboutUpdate(base), true);
  assert.equal(shouldAskAboutUpdate({ ...base, cmd: "shell" }), true); // the prompt
  assert.equal(shouldAskAboutUpdate({ ...base, interactive: false }), false); // piped / script / agent shell
  assert.equal(shouldAskAboutUpdate({ ...base, machine: true }), false); // --format json, --raw
  assert.equal(shouldAskAboutUpdate({ ...base, disabled: true }), false); // JARVIS_NO_UPDATE_CHECK, source checkout
  for (const cmd of ["update", "version", "--version", "help", "completion", "serve"]) assert.equal(shouldAskAboutUpdate({ ...base, cmd }), false, cmd);
});
