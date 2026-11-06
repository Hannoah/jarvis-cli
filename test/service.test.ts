import assert from "node:assert/strict";
import test from "node:test";
import { Service } from "../src/supervisor/service.js";
import { sleep } from "../src/system/proc.js";

test("service: crash loop triggers cooldown auto-recovery and stops cleanly", async () => {
  let launchCount = 0;
  const states: string[] = [];

  const svc = new Service({
    name: "test-service",
    maxRestarts: 2,
    windowMs: 10_000,
    backoffMs: [10, 20],
    readyTimeoutMs: 200,
    crashLoopCooldownMs: 80,
    spawnSpec: () => {
      launchCount++;
      // Once auto-recovered on the 4th launch, keep alive so it doesn't crash loop again
      const script = launchCount >= 4 ? "setTimeout(() => {}, 2000)" : "process.exit(1)";
      return {
        cmd: process.execPath,
        args: ["-e", script],
      };
    },
    ready: async () => launchCount >= 4,
  });

  svc.on("change", (s) => {
    states.push(`${s.state}:${s.message}`);
  });

  await svc.start();

  let attempts = 0;
  while (launchCount < 4 && attempts < 25) {
    await sleep(50);
    attempts++;
  }

  assert.ok(launchCount >= 4, `Expected at least 4 launches, got ${launchCount}`);
  assert.ok(
    states.some((st) => st.includes("failed:") && st.includes("auto-recovering in")),
    `Expected failed state with auto-recovering message, got: ${states.join(" | ")}`
  );

  await svc.stop();
  const launchesAfterStop = launchCount;
  await sleep(100);
  assert.equal(launchCount, launchesAfterStop, "Service should not launch after stop()");
});
