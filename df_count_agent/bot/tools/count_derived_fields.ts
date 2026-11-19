import { fileURLToPath } from "node:url";
import path from "node:path";
import { defineTool } from "@grok/agent-sdk/tools";
import * as z from "zod/v4";
import { countXmlFiles } from "../lib/count-derived-fields.js";

function xmlDirectory(): string {
  const configured = process.env.DF_XML_DIR?.trim();
  if (configured) return configured;
  return fileURLToPath(new URL("../../fixtures/xml/", import.meta.url));
}

export default defineTool({
  description:
    "Count derived fields in each process box of unica_acsesutil flowchart XML reports. Reads every .xml file in DF_XML_DIR, or one file when fileName is set. Does not read .ses files.",
  execution: "server",
  effect: "read",
  inputSchema: z.object({
    fileName: z
      .string()
      .optional()
      .describe("One XML file name in the report directory. Omit to count every XML file."),
  }),
  async execute({ fileName }) {
    return countXmlFiles(xmlDirectory(), fileName);
  },
});
