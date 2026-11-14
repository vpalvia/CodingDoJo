import { defineTool } from "@grok/agent-sdk/tools";
import * as z from "zod/v4";
import { listRecentUnicaLogs } from "../lib/recent-unica-logs.js";

function envPath(name: string): string | null {
  const value = process.env[name];
  if (value == null || value.trim() === "") return null;
  return value.trim();
}

export default defineTool({
  description:
    "List Unica listener (unica_aclsnr.log), campaignweb.log, flowchart, platform.log, and ac_web.log files modified within the last N minutes. Default is 15. Does not return file contents. Roots come from UNICA_CAMPAIGN_HOME, optional UNICA_CAMPAIGN_SHARED_HOME, and UNICA_PLATFORM_HOME.",
  execution: "server",
  effect: "read",
  inputSchema: z.object({
    withinMinutes: z
      .number()
      .int()
      .min(1)
      .max(1440)
      .default(15)
      .describe("How many minutes back to treat a log as recently updated."),
  }),
  async execute({ withinMinutes }) {
    const result = await listRecentUnicaLogs({
      campaignHome: envPath("UNICA_CAMPAIGN_HOME"),
      campaignSharedHome: envPath("UNICA_CAMPAIGN_SHARED_HOME"),
      platformHome: envPath("UNICA_PLATFORM_HOME"),
      withinMinutes,
    });
    return result;
  },
});
