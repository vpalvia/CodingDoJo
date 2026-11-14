# Deployment and security

Campaign configuration lives in the instance database. The client console is the editor. Git tracks package XML exported from that database, not a live copy of the instance.

## Packages

Three built-in package kinds exist:

| Package | Contents |
| --- | --- |
| User | The entities you select. This is the one to use for a project. It can check dependencies. |
| Platform | Added technical resources (schemas, JavaScript, and the other non-standard technical entities), using Adobe's predefined list. |
| Admin | Added business templates and objects, using Adobe's predefined list. |

Export from Tools > Advanced > Export package, from Actions > Export in a package on one object, or from a package definition (Administration > Configuration > Package management) when the same set is exported repeatedly. A package definition is the repeatable choice.

Rules for a package that will be imported on another instance:

- Source and destination must be the same Campaign build. Adobe does not support cross-version import. Do not force the import. Upgrade the destination first.
- Do not include out-of-the-box entities, even if somebody edited them in place. Ship an extension instead.
- Order matters on a fresh instance: schemas and JavaScript libraries before workflows, forms, and delivery templates that reference them.
- After a schema package: regenerate schemas, then run the database-structure update if the physical model changed.
- Folder primary keys differ per instance. Reconcile folders by `@name`, not by `@id`. A package that writes `folder-id` from the source instance will attach rows to the wrong folder, or fail.
- Keep environment values out of the shared package: external-account passwords, tracking URLs, mid-sourcing endpoints, folder ids, and feature options that differ between stage and production. Document them as a checklist the operator sets on each instance.
- One package per feature, with its dependencies, is easier to replay than one package of the whole instance.

Platform and admin packages already exclude stock entities via their filters. Do not "complete" them by also exporting every `nms:` object.

## Instances

Dev, stage, and production are separate instances. Edit on dev, package, import on stage, then import on production. Do not develop on production, and do not point a console at production to try a script.

`serverConf.xml` and the instance config file are server files. They are not package entities. URL permissions, Tomcat settings, and module flags change there, followed by a configuration reload. Do not tell the user to hand-edit them for something the console already stores as an entity.

The v7 application tree on disk is still the Neolane `nl6` tree on many installations (`nlserver`). Confirm the path on the server before suggesting a file edit. Prefer a package over a datakit file drop.

## Rights

Access is folder rights plus named rights.

- Put custom data in a folder the right operator group can see. A schema with no folder discipline is visible to every operator who can open the schema.
- `sysFilter` on the schema restricts read and write no matter which screen is used.
- `access="namedRight"` on a SOAP method restricts that method.
- A navtree `command` right only hides the menu entry.
- The workflow runs as the operator who started it, unless a supervisor or login is configured. A workflow that writes `nms:recipient` needs an operator allowed to write that folder. Do not test it as `admin` and ship it for a restricted login.
- `sqlGet*` and `DBEngine.query` require the `sql` named right. A workflow operator without it will throw. That is a reason to stay on queryDef, which honors schema rights instead.

## Input and output

Treat workflow variables filled from files, web forms, and `PostEvent` as untrusted.

- SQL values go through `$(sz)`, `$(l)`, `$(d)`, `$(ts)`, and the other JSAPI placeholders.
- queryDef literals go through `NL.SQL.escape`.
- HTML and JSSP output go through `NL.XML.escape`. Attribute context uses `NL.XML.escapeAttribute`. A value dropped into a JavaScript string uses `NL.JS.escape`.
- Public web apps get a captcha, a folder the visitor cannot enumerate, and a storage activity that writes only the fields the form collected.

Do not log the payload of a form post. It contains personal data.

## Secrets

Passwords, tracking tokens, and connector secrets belong to external accounts or instance options that stay out of Git. A package export of an external account can contain a secret. Strip it before committing, or exclude that entity and create it on each instance.

Do not put a secret in a JavaScript library, a delivery template, or a default value of a schema attribute.

## Production checklist

Before calling a change ready:

- Out-of-the-box schemas and workflows are unchanged.
- The custom namespace matches the rest of the project.
- Schema generation, and a database update if needed, are in the runbook. Large-table impact is stated.
- The package was tried on a same-build stage instance.
- Production workflows have a supervisor, a description, and no "keep interim results".
- Deliveries still run analysis, so typology, quarantine, and denylist apply.
- Scripts do not select unbounded populations and do not print personal data.
- A second run of the same workflow does not double-insert. `_key` and `insertOrUpdate`, or an incremental query, make the rerun safe.
