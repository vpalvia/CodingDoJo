import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { listRecentUnicaLogs } from "../bot/lib/recent-unica-logs.js";

const NOW = new Date("2026-11-15T12:00:00.000Z");

async function touch(file: string, when: Date): Promise<void> {
  await utimes(file, when, when);
}

async function writeLog(file: string, when: Date): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, "INFO sample\n");
  await touch(file, when);
}

function minutesAgo(minutes: number): Date {
  return new Date(NOW.getTime() - minutes * 60_000);
}

test("lists the five families updated in the last 15 minutes", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "unica-logs-"));
  try {
    const campaign = path.join(root, "Campaign");
    const shared = path.join(root, "shared");
    const platform = path.join(root, "Platform");
    const fresh = minutesAgo(5);
    const stale = minutesAgo(60);

    await writeLog(path.join(campaign, "logs", "unica_aclsnr.log"), fresh);
    await writeLog(path.join(campaign, "logs", "campaignweb.log"), fresh);
    await writeLog(path.join(campaign, "logs", "campaignweb.log.1"), fresh);
    await writeLog(path.join(campaign, "logs", "ETL.log"), fresh);
    await writeLog(path.join(campaign, "logs", "masterlistener.log"), fresh);
    await writeLog(path.join(campaign, "logs", "unica_aclsnr.log.3"), stale);
    await writeLog(path.join(campaign, "logs", "nested", "unica_aclsnr.log"), fresh);
    await writeLog(
      path.join(campaign, "partitions", "partition1", "logs", "SpringSale_C0001_Select.log"),
      fresh,
    );
    await writeLog(
      path.join(campaign, "partitions", "partition1", "logs", "OldDrop_C0099_Mail.log"),
      stale,
    );
    await writeLog(path.join(campaign, "partitions", "partition1", "logs", "ac_web.log"), fresh);
    await writeLog(path.join(campaign, "partitions", "partition1", "logs", "ac_sess.log"), fresh);
    await writeLog(
      path.join(campaign, "partitions", "partition1", "logs", "unica_acsesutil.log"),
      fresh,
    );
    await writeLog(
      path.join(shared, "partitions", "partition2", "logs", "Winback_C0002_Extract.log"),
      fresh,
    );
    await writeLog(path.join(platform, "logs", "platform.log"), minutesAgo(14));
    await writeLog(path.join(platform, "logs", "platform.log.2"), minutesAgo(16));

    const outside = path.join(root, "outside.log");
    await writeFile(outside, "secret\n");
    await symlink(outside, path.join(campaign, "logs", "campaignweb-escape.log"));
    await symlink(
      outside,
      path.join(campaign, "partitions", "partition1", "logs", "Escaped_C0001_Flow.log"),
    );

    const result = await listRecentUnicaLogs({
      campaignHome: campaign,
      campaignSharedHome: shared,
      platformHome: platform,
      withinMinutes: 15,
      now: NOW,
    });

    assert.deepEqual(
      result.files
        .map((file) => `${file.family}:${file.fileName}:${file.partition ?? ""}`)
        .sort(),
      [
        "ac_web:ac_web.log:partition1",
        "campaignweb:campaignweb.log.1:",
        "campaignweb:campaignweb.log:",
        "flowchart:SpringSale_C0001_Select.log:partition1",
        "flowchart:Winback_C0002_Extract.log:partition2",
        "listener:unica_aclsnr.log:",
        "platform:platform.log:",
      ],
    );
    const newest = result.files[0];
    const oldest = result.files[result.files.length - 1];
    assert.ok(newest != null && oldest != null);
    assert.equal(newest.fileName === "platform.log", false);
    assert.equal(oldest.fileName, "platform.log");
    assert.equal(
      result.files.some((file) => file.fileName.includes("escape") || file.fileName.startsWith("Escaped")),
      false,
    );
    assert.equal(result.notes.some((note) => note.includes("points outside")), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("includes a file updated exactly 15 minutes ago and drops an older one", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "unica-boundary-"));
  try {
    const campaign = path.join(root, "Campaign");
    await writeLog(path.join(campaign, "logs", "unica_aclsnr.log"), minutesAgo(15));
    await writeLog(path.join(campaign, "logs", "campaignweb.log"), minutesAgo(15.05));

    const result = await listRecentUnicaLogs({
      campaignHome: campaign,
      platformHome: path.join(root, "missing-platform"),
      withinMinutes: 15,
      now: NOW,
    });

    assert.deepEqual(
      result.files.map((file) => file.fileName),
      ["unica_aclsnr.log"],
    );
    assert.equal(
      result.notes.some((note) => note.includes("UNICA_PLATFORM_HOME does not exist")),
      true,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("reports unset homes and skips a shared home that matches campaign", async () => {
  const unset = await listRecentUnicaLogs({
    withinMinutes: 15,
    now: NOW,
  });
  assert.deepEqual(unset.files, []);
  assert.equal(unset.notes.some((note) => note.includes("UNICA_CAMPAIGN_HOME")), true);
  assert.equal(unset.notes.some((note) => note.includes("UNICA_PLATFORM_HOME")), true);

  const root = await mkdtemp(path.join(tmpdir(), "unica-same-home-"));
  try {
    const campaign = path.join(root, "Campaign");
    await writeLog(path.join(campaign, "logs", "unica_aclsnr.log"), minutesAgo(1));
    const result = await listRecentUnicaLogs({
      campaignHome: campaign,
      campaignSharedHome: campaign,
      platformHome: path.join(root, "Platform"),
      withinMinutes: 15,
      now: NOW,
    });
    assert.equal(result.files.length, 1);
    assert.equal(
      result.notes.some((note) => note.includes("matches UNICA_CAMPAIGN_HOME")),
      true,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("stops after the requested file limit", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "unica-limit-"));
  try {
    const campaign = path.join(root, "Campaign");
    await writeLog(path.join(campaign, "logs", "unica_aclsnr.log"), minutesAgo(1));
    await writeLog(path.join(campaign, "logs", "campaignweb.log"), minutesAgo(2));
    const result = await listRecentUnicaLogs({
      campaignHome: campaign,
      platformHome: path.join(root, "Platform"),
      withinMinutes: 15,
      now: NOW,
      limit: 1,
    });
    assert.equal(result.files.length, 1);
    assert.equal(result.files[0]?.fileName, "unica_aclsnr.log");
    assert.equal(result.notes.some((note) => note.includes("Stopped after 1")), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
