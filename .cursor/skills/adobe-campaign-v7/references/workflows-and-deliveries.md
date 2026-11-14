# Workflows and deliveries

Design the workflow so an operator can read the diagram. JavaScript is for a step the activities cannot express, not for the whole process.

## Naming and ownership

- Internal name: stable, no spaces, prefix with the project (`cusImportSales`). Labels can change.
- When several workflows form a pipeline, number the labels (`001 - Import - Sales`, `002 - Import - Sales lines`) and explain the pipeline in the description.
- Set a supervisor group that contains at least one operator with an email address. A production workflow with no supervisor fails silently from the operator's point of view.
- Do not leave a workflow paused. A paused instance keeps its work tables.
- Do not run two uncoordinated workflows that write the same rows. Chain them with an External signal and `xtk.workflow.PostEvent`.

## Scheduling

One Scheduler (or one external signal) per workflow. A schedule that can overlap itself needs an explicit guard: skip this run when the previous instance is still running, or split the work so two runs do not write the same key. Do not stack a second scheduler to "retry faster".

A failed run stays in error until an operator restarts it, unless the workflow is built to alert and stop cleanly. `logError` is that stop.

Temporary work tables are dropped between executions unless "keep the result of interim populations between two executions" is checked. That option is a debugging aid on a non-production instance. Do not enable it on production.

## Populations

Query, Incremental query, and the set activities (Union, Intersection, Exclusion, Split, Deduplication, Enrichment) keep rows in a work table. The next activity receives that table. Preserve the targeting-dimension primary key (`@id` on `nms:recipient`) through the chain. Additional data travels on the work table and is what a later Delivery can read as `targetData`.

Targeting dimension is who you send to. Filtering dimension is the table you start the query from. They differ when you start from a log or a custom event and target the linked recipient. State both when you propose a query.

Prefer Incremental query for a recurring extract so each run sees only new or changed keys. Prefer Deduplication before a delivery when the upstream join can duplicate a recipient.

In a JavaScript activity that must inspect the inbound population, query the work-table schema passed in on the transition (`vars.targetSchema` when that input parameter is present). Page it. Do not call `select` on `nms:recipient` with no `lineCount` to "see what the query returned".

## Activity choice

| Goal | Activity |
| --- | --- |
| Audience | Query or Incremental query |
| Add columns | Enrichment |
| Random or rule split | Split |
| Remove overlap | Exclusion or Intersection |
| Collapse duplicates | Deduplication |
| Insert or update rows | Update data |
| Match to an existing key | Reconciliation |
| Branch on a variable | Test |
| Wait for another process | External signal |
| Send | Delivery, fed by the inbound population |
| Land a file | File collector, then Data loading (file), with a reject file |
| Produce a file | Extract file |
| Call a second workflow | `PostEvent` plus External signal |

Use a SQL code activity only for a set operation queryDef cannot express, with the same parameter and DBMS rules as any other SQL.

Initialization scripts change `activity` for the current task only. The documented split example sets a sampling percent from an instance variable:

```javascript
activity.transitions.extractOutput[0].limiter.percent = instance.vars.segmentpercent;
```

Change activity properties this way only when the field has no JavaScript template of its own.

## Deliveries

A delivery template is an `nms:delivery` model. Business workflows reference the template. They do not rebuild the HTML, the routing, and the typology on every run.

- Routing comes from an external account (`nms:extAccount`): mid-sourcing, an external MTA, or an SMS connector. Do not hard-code SMTP hosts in a script.
- Analysis (prepare) runs before a production send. A workflow delivery that skips analysis also skips typology.
- Typology rules own fatigue, quarantine, denylist, control groups, capacity, and channel eligibility. Do not reimplement those filters as a one-off query and call the audience safe. `@blackList` on the recipient is only the denylist flag. Email quarantine lives on `nms:address` and is applied by typology.
- Subscriptions are `nms:subscription` rows pointed at an `nms:service`. Filter with `EXISTS` on that collection.
- Proofs and a seed group go out before the audience. A control group is a typology rule, not a random split copied into a list by hand.
- Personalize profile fields with `<%= recipient.firstName %>`. Personalize values added by the workflow (Enrichment or the query's additional data) with `<%= targetData.fieldName %>`. `targetData` exists on a delivery whose inbound transition carries that population. It is not available on a delivery started outside the workflow.
- Conditional content uses scriptlets inside the HTML (`<% if (...) { %>` ... `<% } %>`). Keep the condition on data already loaded for the message. Do not call queryDef per recipient inside the content.
- Include a shared block with a personalization block (`<%@ include view="blockName" %>`), not a copy of the HTML.
- Broad logs and tracking logs are written by the delivery engine. A script that `Write`s them will not create a coherent send, and it will desynchronize tracking and billing.

## Transactional messaging

Message Center, when the instance has that module, is a control instance plus an execution instance. Event types and templates are designed on the control instance and published to the execution instance. Traffic arrives as events (`nms:rtEvent`), not as a batch Query. Do not fake transactional mail with a one-minute scheduled delivery. If the module is absent, say so and stop; do not invent a `PushEvent` integration.

## Offer management

Interaction, when licensed, stores offers, categories, eligibility rules, and spaces. Outbound offers are attached to a delivery. Inbound offers are returned by the inbound interaction call. Eligibility belongs in the offer rules, not in a parallel suppression workflow that can drift from the space.

## Files

Data loading (file) and Extract file already handle rejects, column mapping, and volume. Parse a file in JavaScript only for a small control file. A workflow that reads a multi-gigabyte file into a string will fail the activity memory limit.

File collector plus a scheduled workflow is the usual drop-folder pattern. Pass `vars.filename` to the loader. Archive or reject the file so the next run does not load it again.
