---
name: adobe-campaign-v7
description: >-
  Connect to an Adobe Campaign Classic v7 server over SOAP and list its data
  schemas (xtk:srcSchema). Use when the user wants to log on to Campaign,
  list schemas, or call the SOAP API at /nl/jsp/soaprouter.jsp.
---

# Adobe Campaign Classic v7

Connect to one Campaign Classic v7 instance and list its data schemas. That is the whole task. Do not design workflows, write deliveries, or change schemas unless the user asks for a next step.

Campaign v8 and Campaign Standard use different APIs. This skill talks to Classic v7 at `/nl/jsp/soaprouter.jsp`.

## Connection

The script reads three environment variables. Do not put the password on the command line, in a file in this repo, or in the chat.

| Variable | Value |
| --- | --- |
| `ACC_URL` | Server origin, such as `https://campaign.example.com` |
| `ACC_USER` | Operator login |
| `ACC_PASSWORD` | Operator password |

A lab server with a private certificate also needs `ACC_TLS_VERIFY=0`. Leave that unset when the certificate is public.

If any of the three variables is missing, stop and name the ones to set. Do not invent a host, a login, or a password.

## List the schemas

From the repo root:

```bash
python3 .cursor/skills/adobe-campaign-v7/scripts/list_schemas.py
```

The script logs on with `xtk:session#Logon`, pages `xtk:srcSchema` with `xtk:queryDef#ExecuteQuery`, prints one schema per line, and logs off. `xtk:srcSchema` is the Data schemas list in the client console. Each line is `namespace`, `name`, and `label`, separated by tabs.

Report the count and the lines. Repeat a schema id as `namespace:name`. Do not print the session token, the security token, or the password.

A SOAP fault or an HTTP error is the result. Show the fault string and stop. Do not retry with a different login.

The operator must be allowed to read data schemas. An admin operator can. A restricted operator may receive a permissions fault.

## After the list

Wait for the user. The list is the deliverable.
