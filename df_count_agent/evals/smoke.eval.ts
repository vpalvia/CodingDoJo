import { defineEval, satisfies } from "@grok/agent-sdk/evals";

export default defineEval({
  tags: ["smoke"],
  description: "Count derived fields per process box in the flowchart XML reports.",
  async test(t) {
    await t.send(
      "Count the derived fields in each process box of the flowchart XML reports.",
    );
    t.succeeded();
    t.calledTool("count_derived_fields", { status: "completed" });
    t.check(
      t.reply,
      satisfies((value) => {
        const text = String(value);
        return text.includes("Select1") && text.includes("Snapshot1") && text.includes("Extract1");
      }, "reply names the process boxes"),
    );
  },
});
