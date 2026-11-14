import { utimes } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineEval, satisfies } from "@grok/agent-sdk/evals";

const fixtureRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../fixtures/unica",
);
const campaignHome = path.join(fixtureRoot, "Campaign");
const platformHome = path.join(fixtureRoot, "Platform");

const FRESH = [
  "Campaign/logs/unica_aclsnr.log",
  "Campaign/logs/campaignweb.log",
  "Campaign/logs/campaignweb.log.1",
  "Campaign/logs/ETL.log",
  "Campaign/logs/masterlistener.log",
  "Campaign/partitions/partition1/logs/SpringSale_C0001_Select.log",
  "Campaign/partitions/partition1/logs/ac_web.log",
  "Campaign/partitions/partition1/logs/ac_sess.log",
  "Campaign/partitions/partition1/logs/unica_acsesutil.log",
  "Campaign/partitions/partition2/logs/Winback_C0002_Extract.log",
  "Platform/logs/platform.log",
];

const STALE = [
  "Campaign/logs/unica_aclsnr.log.3",
  "Campaign/partitions/partition1/logs/OldDrop_C0099_Mail.log",
];

const EXPECTED = [
  "unica_aclsnr.log",
  "campaignweb.log",
  "campaignweb.log.1",
  "SpringSale_C0001_Select.log",
  "Winback_C0002_Extract.log",
  "ac_web.log",
  "platform.log",
];

const EXCLUDED = [
  "ETL.log",
  "masterlistener.log",
  "ac_sess.log",
  "unica_acsesutil.log",
  "OldDrop_C0099_Mail.log",
  "unica_aclsnr.log.3",
];

function fileNames(output: unknown): string[] {
  if (output == null || typeof output !== "object" || !("files" in output)) return [];
  const files = output.files;
  if (!Array.isArray(files)) return [];
  return files.flatMap((file) => {
    if (file == null || typeof file !== "object" || !("fileName" in file)) return [];
    return typeof file.fileName === "string" ? [file.fileName] : [];
  });
}

function listsTheRecentScope(output: unknown): boolean {
  const names = new Set(fileNames(output));
  return (
    EXPECTED.every((name) => names.has(name)) &&
    EXCLUDED.every((name) => !names.has(name))
  );
}

async function prepareFixtures(): Promise<void> {
  const now = new Date();
  const stale = new Date(now.getTime() - 60 * 60 * 1000);
  await Promise.all(
    FRESH.map((file) => utimes(path.join(fixtureRoot, file), now, now)),
  );
  await Promise.all(
    STALE.map((file) => utimes(path.join(fixtureRoot, file), stale, stale)),
  );
  process.env.UNICA_CAMPAIGN_HOME = campaignHome;
  process.env.UNICA_PLATFORM_HOME = platformHome;
  delete process.env.UNICA_CAMPAIGN_SHARED_HOME;
}

export default defineEval({
  tags: ["smoke"],
  description: "List Unica logs updated in the last 15 minutes.",
  cases: [
    {
      id: "all-families",
      description: "All five in-scope families that changed in the last 15 minutes.",
      async test(t) {
        await prepareFixtures();
        await t.send(
          "List all Unica log files updated in the last 15 minutes. Include listener, campaignweb, flowchart, platform, and ac_web logs.",
        );
        t.succeeded();
        t.calledTool("list_recent_unica_logs", {
          input: { withinMinutes: 15 },
          status: "completed",
          output: (output) => listsTheRecentScope(output),
        });
        t.check(
          t.reply,
          satisfies((value) => {
            const text = String(value);
            return [
              "unica_aclsnr.log",
              "campaignweb.log",
              "SpringSale_C0001_Select.log",
              "Winback_C0002_Extract.log",
              "platform.log",
              "ac_web.log",
            ].every((name) => text.includes(name));
          }, "reply names each fresh in-scope log"),
        );
      },
    },
    {
      id: "flowcharts",
      description: "Flowchart logs updated in the last 15 minutes.",
      async test(t) {
        await prepareFixtures();
        await t.send("Which flowchart logs were updated in the last 15 minutes?");
        t.succeeded();
        t.calledTool("list_recent_unica_logs", {
          input: { withinMinutes: 15 },
          status: "completed",
        });
        t.check(
          t.reply,
          satisfies((value) => {
            const text = String(value);
            return (
              text.includes("SpringSale_C0001_Select.log") &&
              text.includes("Winback_C0002_Extract.log")
            );
          }, "reply names both fresh flowchart logs"),
        );
      },
    },
    {
      id: "platform-and-ac-web",
      description: "platform.log and ac_web.log updated in the last 15 minutes.",
      async test(t) {
        await prepareFixtures();
        await t.send(
          "Were platform.log or ac_web.log updated in the last 15 minutes?",
        );
        t.succeeded();
        t.calledTool("list_recent_unica_logs", {
          input: { withinMinutes: 15 },
          status: "completed",
        });
        t.check(
          t.reply,
          satisfies((value) => {
            const text = String(value);
            return text.includes("platform.log") && text.includes("ac_web.log");
          }, "reply names platform.log and ac_web.log"),
        );
      },
    },
  ],
});
