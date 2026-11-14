---
name: adobe-campaign-v7
description: >-
  Connect to an Adobe Campaign Classic v7 server over SOAP and list its data
  schemas (xtk:srcSchema) or workflow runs from the past 24 hours
  (xtk:workflowTask) with duration. Use when the user wants to log on to
  Campaign, list schemas, list recent workflow runs, or call
  /nl/jsp/soaprouter.jsp.
---

# Adobe Campaign Classic v7

Connect to one Campaign Classic v7 instance and list either its data schemas or the workflow runs that had activity in the past 24 hours. Do not design workflows, write deliveries, or change schemas unless the user asks for a next step.

Campaign v8 and Campaign Standard use different APIs. This skill talks to Classic v7 at `/nl/jsp/soaprouter.jsp`.

## Connection

Both scripts read three environment variables. Do not put the password on the command line, in a file in this repo, or in the chat.

| Variable | Value |
| --- | --- |
| `ACC_URL` | Server origin, such as `https://campaign.example.com` |
| `ACC_USER` | Operator login |
| `ACC_PASSWORD` | Operator password |

A lab server with a private certificate also needs `ACC_TLS_VERIFY=0`. Leave that unset when the certificate is public.

If any of the three variables is missing, stop and name the ones to set. Do not invent a host, a login, or a password.

## List data schemas

From the repo root:

```bash
python3 .cursor/skills/adobe-campaign-v7/scripts/list_schemas.py
```

The script logs on with `xtk:session#Logon`, pages `xtk:srcSchema` with `xtk:queryDef#ExecuteQuery`, prints one schema per line, and logs off. `xtk:srcSchema` is the Data schemas list in the client console. Each line is `namespace`, `name`, and `label`, separated by tabs. Repeat a schema id as `namespace:name`.

## List workflow runs from the past 24 hours

From the repo root:

```bash
python3 .cursor/skills/adobe-campaign-v7/scripts/list_workflow_runs.py
```

The script reads `xtk:workflowTask`. Each row is one activity execution, not one workflow run. It keeps tasks that started or finished in the past 24 hours (`AddHours(GetDate(), -24)` on the server) and groups them into runs.

Tasks that overlap, and a task that starts within 5 seconds after the latest completion, stay in the same run. A later start is another run of that workflow. A workflow that starts again within those 5 seconds stays on the same line.

Each output line is `workflow`, `label`, `started`, `ended`, `duration`, `activities`, and `status`, separated by tabs. `workflow` is the internal name. `duration` is the time from the earliest task start to the latest task end, printed only when `status` is `completed`. A run with a task that has no completion time has status `running` and an empty duration.

Tell the user these limits with the result:

- Times are the values Campaign returned.
- A run that began before the 24-hour window can look shorter, because only tasks that started or finished inside the window are included.
- Tasks older than the workflow **History in days** setting are already deleted.

## After the list

Report the count and the lines. Do not print the session token, the security token, or the password.

A SOAP fault or an HTTP error is the result. Show the fault string and stop. Do not retry with a different login.

The operator must be allowed to read the entity being queried. An admin operator can. A restricted operator may receive a permissions fault.

Wait for the user. The list is the deliverable.
