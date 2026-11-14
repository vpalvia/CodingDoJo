import { defineEvalConfig } from "@grok/agent-sdk/evals";

export default defineEvalConfig({
  // These cases share one fixture tree and the process environment.
  maxConcurrency: 1,
});
