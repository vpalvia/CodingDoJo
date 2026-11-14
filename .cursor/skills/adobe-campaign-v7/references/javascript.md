# JavaScript in Campaign Classic v7

Server scripts run in workflow activities, workflow initialization scripts, JSSP pages, web applications, typology rules, and SOAP methods. The language is JavaScript with E4X. Write `var`. Build XML with literals (`<recipient/>`), not with string concatenation. Iterate with `for each`.

There is no `getRecipient` or `getDelivery`. Read with `xtk.queryDef` and write with `xtk.session.Write` / `WriteCollection`.

Static methods are called on the namespace object: `xtk.session.Write(...)`, `xtk.workflow.PostEvent(...)`. Non-static methods need an entity first: `xtk.queryDef.create(<queryDef .../>)`.

## queryDef

```javascript
var query = xtk.queryDef.create(
  <queryDef schema="nms:recipient" operation="getIfExists">
    <select>
      <node expr="@id"/>
      <node expr="@lastName"/>
      <node expr="[folder/@name]"/>
    </select>
    <where>
      <condition expr={"@email = '" + NL.SQL.escape(email) + "'"}/>
    </where>
  </queryDef>
);

var recipient = query.ExecuteQuery();
if (recipient.@id != undefined) {
  logInfo("Found recipient " + recipient.@id);
}
```

`operation` is one of:

| Operation | Result |
| --- | --- |
| `select` | A collection. Empty document when nothing matches. Default when omitted. |
| `get` | One element. Errors when no row matches. Use it only when a missing row is a defect. Do not wrap it in `try/catch` to hide that. |
| `getIfExists` | One element, or an empty element such as `<recipient/>`. |
| `count` | One element with `@count`. No `select` clause. |

Iterate a select:

```javascript
var res = query.ExecuteQuery();
for each (var row in res.recipient) {
  logInfo(row.@lastName);
}
```

The child element name is the schema element (`recipient`, `workflow`, `delivery`), not a name you invent.

Always set `lineCount` on a `select` that can return more than a handful of rows. Page the rest with `startLine` (the next page of 100 starts at `startLine="100"`). Do not omit the cap and hope the engine returns everything.

```javascript
<queryDef schema="nms:recipient" operation="select" lineCount="100" startLine="0">
```

Other clauses:

- `orderBy` / `node` with `sortDesc="true"` or `"false"`.
- `groupBy`, or `groupBy="true"` on the select node. `having` holds the group condition.
- `alias="@outputName"` moves a value onto an attribute of the result element.
- Nested `<condition>` elements add parentheses. `boolOperator="OR"` on a condition switches that term off the default `AND`.
- A collection filter uses `setOperator="EXISTS"` (or `NOT EXISTS`) and a `<condition>` child whose `expr` is the collection path. Do not pull collection fields into the parent `select` unless the child side is known to be a single row.

Link examples:

- Filter on a linked label: `[folder/@label] = 'Recipients'`
- Foreign key: `[@folder-id] = 1234`
- Subquery: a `<subQuery schema="...">` inside a `<condition setOperator="NOT IN" expr="@id">`.

Dates written as `#2002/02/01#` are bound by the engine. Set `noSqlBind="true"` on a node only when you intentionally need the literal in the SQL (required around some `orderBy` / `groupBy` cases). Prefer binding.

`NL.SQL.escape` prepares a value to sit inside quotes you still add yourself. Coerce numbers with `Number(...)` and refuse `NaN` instead of escaping them into a string. Never concatenate `request.getParameter(...)` raw into an expression.

## Write and delete

Default `_operation` is `insertOrUpdate`. Set it anyway. `_key` is a comma-separated list of XPaths. The document must include `xtkschema`.

```javascript
xtk.session.Write(
  <recipient xtkschema="nms:recipient"
             _operation="insertOrUpdate"
             _key="@email,[@folder-id]"
             email={email}
             firstName={firstName}
             folder-id={folderId}/>
);
```

| `_operation` | Behavior |
| --- | --- |
| `insert` | Insert. The reconciliation key is not used. |
| `insertOrUpdate` | Update when the key matches, otherwise insert. |
| `update` | Update. Does nothing when the key is absent. |
| `delete` | Delete the matching rows. Pass only key fields. |
| `none` | Reconcile a linked element. Do not insert or update that element. |

```javascript
xtk.session.Write(
  <recipient xtkschema="nms:recipient" _operation="update" _key="@email" email={email}>
    <folder name="vip" _operation="none"/>
  </recipient>
);
```

`WriteCollection` takes one parent element whose children share `xtkschema` on the parent:

```javascript
xtk.session.WriteCollection(
  <recipient-collection xtkschema="nms:recipient">
    <recipient _operation="insertOrUpdate" _key="@email" email="a@example.com" firstName="A"/>
    <recipient _operation="insertOrUpdate" _key="@email" email="b@example.com" firstName="B"/>
  </recipient-collection>
);
```

An older tutorial writes `operation="_update"` (underscore on the value, not the attribute). Prefer `_operation="update"`. Leave existing `operation="_update"` code alone unless you are already rewriting that write.

Delete by condition:

```javascript
xtk.session.DeleteCollection(
  "nms:recipient",
  <where>
    <condition expr={"@email = '" + NL.SQL.escape(email) + "'"}/>
  </where>,
  false
);
```

XML memo fields are replaced wholesale unless each collection child sets `_operation` so the engine merges.

`Write` returns nothing. A duplicate key or a failed SQL statement throws, and the workflow stops on that error.

## SQL

Use SQL only when queryDef cannot say it. The operator needs the `sql` named right.

`sqlGetInt`, `sqlGetString`, `sqlGetDouble`, and `sqlGetDate` accept parameters. `sqlSelect` does not. For more than one row or column, use `DBEngine.query`.

Placeholders, each matched by an argument: `$(sz)` string, `$(m)` memo, `$(l)` long, `$(s)` short, `$(b)` byte, `$(d)` double, `$(f)` float, `$(ts)` timestamp, `$(dt)` date, `$(tm)` time, `$(dur)` duration in milliseconds.

Update-only substitutions that take no argument: `$(id)`, `$(id:SomeSequence)`, `$(curdate)`.

```javascript
var id = sqlGetInt(
  "SELECT iRecipientId FROM NmsRecipient WHERE sEmail = $(sz)",
  email
);
```

```javascript
var cnx = application.getConnection();
try {
  var stmt = cnx.query(
    "SELECT iRecipientId, sLastName FROM NmsRecipient WHERE sEmail = $(sz)",
    email
  );
  for each (var row in stmt) {
    logInfo(row[0] + " " + row[1]);
  }
} finally {
  cnx.dispose();
}
```

`row[0]` is the first selected column. Dispose a connection you open; a long-lived script will hold it otherwise. The engine also frees it when a short script ends.

Take table and column names from the schema (`sqltable`, `sqlname`). The usual mapping is `nms:recipient` to `NmsRecipient`, a string `@email` to `sEmail`, and a long `@id` to `iRecipientId`, but a custom `sqlname` overrides that. Do not guess.

Do not hard-code `LIMIT`, `TOP`, or `ROWNUM`. Branch on `application.getDBMSType()` (`postgresql`, `oracle`, `mssql`) or, better, stay on queryDef.

SQL functions used from the expression editor must be allowlisted. On builds older than 8140, `XtkPassUnknownSQLFunctionsToRDBMS` set to `1` forwards unknown functions to the database. Leave it at `0` unless the instance already depends on it.

## Workflow script objects

Available in a workflow script:

| Object | Meaning |
| --- | --- |
| `instance` | The running workflow (`xtk:workflow`). |
| `task` | The running task (`xtk:workflowTask`). |
| `activity` | The activity model for this task. An initialization script may change it for this task only. |
| `event` | The event that activated this task. Unset when an AND-join was woken by several transitions. |
| `events` | Every activating event. |
| `vars` | Event variables. Passed to the next activity. Prefer these. |
| `instance.vars` | Visible to every activity in the instance. |
| `task.vars` | Local to this task. The next activity does not see them. |

Variables hold strings, numbers, or `Date` values. Properties of `instance`, `task`, `event`, and `activity` are read-only except `vars`. Values you read were last persisted at the previous passivation, so they can lag the live row.

In a query activity, read an instance variable as `$(instance/vars/@deliveryIN)`.

`vars.filename` is set by export activities. Other activity variables are documented per activity as input and output parameters. Do not invent a variable name an activity does not publish.

`logInfo(message)` writes the journal. `logError(message)` writes the journal, stops the script, and moves the workflow to error.

Comment the activity internal name at the top of a script as `-- activityName --` so a package diff shows where the script lives.

## Wake another workflow

```javascript
xtk.workflow.PostEvent(
  "wkfImportSales",
  "signal",
  "",
  <variables fileName={fileName}/>,
  false
);
```

Arguments: workflow internal name, target activity name, transition name (empty string when the activity has one relevant transition), a `<variables/>` element, then a boolean. Adobe documents `true` as "trigger only once" and `false` as "post on every call". `PostEvent` is asynchronous. The target workflow must already be started. A suspended workflow keeps the event queued until it resumes. The signal activity does not need a task already waiting.

## Libraries, JSSP, and HTTP

Put a function used by more than one workflow in an `xtk:javascript` entity and load it with `loadLibrary("cus:libName")` using the entity's namespace and name.

JSSP pages use `<% %>` for server script and `<%= %>` to print. Escape anything printed into HTML. Read inputs with `request.getParameter`, then escape or parameterize before they reach a query. Public landing pages need a captcha. Campaign's own captcha is `CaptchaIDGen` / `CaptchaValidate`. A Google reCAPTCHA check uses `HttpClientRequest`, and the verification URL has to be added to `urlPermission` in `serverConf.xml` (required from build 8797).

```javascript
var req = new HttpClientRequest("https://example.internal/hook");
req.method = "POST";
req.header["Content-Type"] = "application/x-www-form-urlencoded";
req.body = "payload=" + encodeURIComponent(body);
req.execute();
```

Do not put a secret in the script source. Read it from an option or an external account that is not exported in a shared package.

Outbound HTTP from a workflow is a side effect with no transaction around the remote call. If `Write` succeeds and the HTTP call fails, the row is already stored. Design for a retry that is safe to run twice.
