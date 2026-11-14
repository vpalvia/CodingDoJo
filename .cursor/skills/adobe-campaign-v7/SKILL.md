---
name: adobe-campaign-v7
description: >-
  Implement and review Adobe Campaign Classic v7 work: data schemas and
  extensions, input forms, workflow JavaScript (E4X, queryDef,
  xtk.session.Write), deliveries, personalization, typology, web applications,
  JSSP, and package deployment. Use when the user mentions Adobe Campaign,
  Campaign Classic, Campaign v7, Neolane, nlserver, nms:recipient, queryDef,
  xtk.session, a workflow activity, a delivery template, or a datakit package.
  Do not use for Campaign v8 FFDA or Campaign Standard.
metadata:
  product: Adobe Campaign Classic v7
  version: "1.0"
---

# Adobe Campaign Classic v7

Build and review Campaign Classic v7 artifacts the way the console stores them: XML schemas, E4X JavaScript, workflow activities, and packages. Server-side JavaScript is the Campaign engine (ECMAScript plus E4X). It is not Node and not a browser.

Campaign v8 (managed cloud, Snowflake / FFDA, ingestion APIs) and Campaign Standard are different products. Do not copy their APIs into a v7 answer. If the user is unsure which product they run, ask before writing code.

## Read the matching reference first

Read only the reference the task needs. Paths are relative to this skill.

| Task | Read |
| --- | --- |
| queryDef, Write, SQL, libraries, JSSP, escaping | [references/javascript.md](references/javascript.md) |
| srcSchema, extensions, links, forms, indexes | [references/schemas.md](references/schemas.md) |
| Workflow design, variables, populations, deliveries, typology | [references/workflows-and-deliveries.md](references/workflows-and-deliveries.md) |
| Packages, builds, rights, secrets, prod safety | [references/deployment-and-security.md](references/deployment-and-security.md) |

When a method is not in those notes or in the Campaign JSAPI, say so. Do not invent SOAP methods, activity parameters, or schema attributes.

Official references:

- Data-oriented APIs: `https://experienceleague.adobe.com/en/docs/campaign-classic/using/configuring-campaign-classic/api/data-oriented-apis`
- Workflow JavaScript: `https://experienceleague.adobe.com/en/docs/campaign/automation/workflows/advanced-management/javascript-in-workflows`
- Script objects and variables: `https://experienceleague.adobe.com/en/docs/campaign/automation/workflows/advanced-management/javascript-scripts-and-templates`
- Scripting security: `https://experienceleague.adobe.com/en/docs/campaign-classic/using/installing-campaign-classic/security-privacy/scripting-coding-guidelines`
- JSAPI: `https://experienceleague.adobe.com/developer/campaign-api/api/c-Adobe-Campaign-JavaScript.html`

## Choose the least custom mechanism

Use the first option that can express the requirement.

1. A native workflow activity (Query, Incremental query, Enrichment, Deduplication, Split, Union, Exclusion, Update data, Reconciliation, Delivery, File collector, Data loading, Extract file, Scheduler, External signal, Test, Alert).
2. A schema expression or personalization block, when the change is display or content.
3. Workflow JavaScript that calls `xtk.queryDef` or `xtk.session.Write`.
4. Parameterized SQL through `sqlGet*` or `application.getConnection().query()`, only when queryDef cannot express it.

SQL is a last resort. It bypasses the logical model, named rights, and DBMS portability. `sqlSelect` does not accept parameters; do not use it with external input.

## Hard rules

- Extend out-of-the-box schemas in a custom namespace. Do not edit built-in `nms:` or `xtk:` source schemas, and do not edit out-of-the-box workflows. Adobe does not support instances that were customized that way, and the next upgrade overwrites or conflicts with the edit.
- Do not extend schemas Adobe marks as non-extendable (`mappingType="xmlFile"`, `dataSource="file"`, plus the list in [references/schemas.md](references/schemas.md)).
- JavaScript that must run on v7 uses `var`, string concatenation, E4X XML literals, and `for each`. Do not use `let`, `const`, arrow functions, template literals, Promises, `fetch`, or Node modules. `JSON.parse` is not safe to assume unless the script loads `shared/json2.js` or the instance build is known to provide it.
- Keep populations in workflow work tables. Do not select a marketing audience into a JavaScript array.
- Set `_operation` and `_key` on every `xtk.session.Write`. The default operation is `insertOrUpdate`, which updates an existing row when the key matches.
- Parameterize every SQL value (`$(sz)`, `$(l)`, `$(d)`, `$(ts)`, and the other placeholders in the JSAPI). Escape values that must be embedded in a queryDef expression with `NL.SQL.escape`. Escape XML and JavaScript with `NL.XML.escape`, `NL.XML.escapeAttribute`, and `NL.JS.escape`.
- Do not log email addresses, phone numbers, or other personal data. `logInfo` on a frequent workflow grows the workflow log quickly.
- `logError` stops the script and puts the workflow in error (paused by default). Use it for real failures only.
- A form condition (`visibleIf`, `enabledIf`) is not security. Protect data with folder rights, `sysFilter`, and the `access` attribute on SOAP methods. Confidential columns belong on an overflow table, not hidden on the form.
- Do not enable "keep the result of interim populations between two executions" on production. It retains work tables and grows the database.
- Import packages only between instances on the same build. Do not force an import across builds. A schema package still requires schema generation and, when columns change, a database-structure update.
- Do not update broad logs or tracking logs by hand. Send, quarantine, and tracking stay on the delivery and typology path.

## What to clarify before a large change

Ask only what the repository and the request do not already answer.

- Custom namespace, if the repo does not already use one. Do not invent a second namespace beside an existing one.
- Target schema and whether the user wants an extension or a new schema.
- Database engine, if the solution needs SQL. `application.getDBMSType()` is the runtime check; `LIMIT`, `ROWNUM`, and `TOP` are not interchangeable.
- Environment, if the change alters `nms:recipient` or another large table. A database update can lock that table. Call that out before giving the steps.

## How to answer

Produce artifacts the user can paste into the client console or into a package XML file.

- Name the entity (`nms:recipient`, `xtk:workflow`, `cus:recipient`) and the namespace.
- For a schema change, include the extension `srcSchema`, the input-form change if operators must see the field, and the follow-up: save, regenerate schemas, update the database structure only if the physical table changes, then package.
- For a workflow, prefer a short activity chain over a long script. When JavaScript is required, put it in a JavaScript code activity or an `xtk:javascript` library loaded with `loadLibrary("namespace:name")`. Pass data onward in event variables (`vars`). Use `instance.vars` only for a value later activities must read as `$(instance/vars/@name)`.
- For a delivery, keep audience logic in the workflow or typology. Personalize from the inbound population with `<%= targetData.field %>`. Personalize profile fields with `<%= recipient.field %>`.
- State the production risk in one or two sentences: table lock, log volume, overlapping schedules, package order, or a missing typology rule. Do not pad the answer with a general tutorial.

## Campaign objects, in short

| Need | Object |
| --- | --- |
| Profile | `nms:recipient` |
| Folder | `xtk:folder` |
| Workflow | `xtk:workflow` |
| Delivery or template | `nms:delivery` |
| Broad log / tracking (recipient mapping) | `nms:broadLogRcp`, `nms:trackingLogRcp` |
| Service subscription | `nms:service`, `nms:subscription` |
| Typology rule | `nms:typology`, `nms:typologyRule` |
| External account (routing, FDA, SMS) | `nms:extAccount` |
| Option | `xtk:option` via `getOption` / `setOption` |
| Reusable script | `xtk:javascript`, loaded with `loadLibrary` |
| Operator-facing screen | `xtk:form` (separate from the schema) |
| Deployable bundle | package definition under Administration > Configuration > Package management |

XPath cheat sheet: `@email` is an attribute, `[@folder-id]` is a foreign key, `[folder/@name]` is a field on a link. Filter a collection with `EXISTS` / `NOT EXISTS`. Do not select an unbounded collection into the parent row; the query returns a cartesian product.

## Done when

- The snippet uses schema paths, not guessed physical column names, unless it is the rare SQL path. Physical names then come from the schema's `sqltable` and `sqlname`.
- Writes declare `_operation` and `_key`.
- Queries that can return many rows set `lineCount` and page with `startLine`.
- Untrusted input is parameterized or escaped.
- Out-of-the-box sources are untouched.
- The follow-up console steps are named: regenerate, database update, package, same-build import.
