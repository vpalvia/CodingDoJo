# Schemas, extensions, and forms

A `srcSchema` is the source the console edits. Campaign generates the runtime schema from it. The database update wizard reads the generated schema, not the form.

Identify a schema as `namespace:name` (`nms:recipient`, `xtk:workflow`, `cus:loyalty`). New project schemas use the project's namespace. Do not create new entities in `nms`, `xtk`, or `nl`.

## Extend, do not patch

Create a second `srcSchema` with the same `name`, the custom `namespace`, and `extendedSchema` set to the built-in schema. The generated schema merges the extension fields into the original. The extension does not create a second table.

```xml
<srcSchema namespace="cus" name="recipient" extendedSchema="nms:recipient"
           label="Recipient">
  <element name="recipient">
    <attribute name="loyaltyId" label="Loyalty ID" type="string" length="64"/>
    <element name="location">
      <attribute name="storeCode" label="Store code" type="string" length="32"/>
    </element>
  </element>
</srcSchema>
```

The element name matches the root element of the extended schema (`recipient` for `nms:recipient`). Put an attribute on the existing link element (`location`) when you are adding a column to that linked structure, and only when that structure is itself mapped to SQL.

`belongsTo` on a field records which schema declared it. `dependingSchemas` on a root records extension dependencies. Leave both to the console when it fills them.

After saving:

1. Regenerate schemas so the runtime schema picks up the extension.
2. Run the database-structure update only if a column, index, or table changed.
3. Ship the extension in a package. The next Campaign upgrade preserves an extension. It does not preserve an edit made inside the built-in source.

Adding a column or index on `NmsRecipient` (or any other large built-in table) can lock that table for the duration of the update. Say so, and prefer a new schema plus a link when the column is hot, wide, or confidential.

## Schemas you must not extend

Adobe forbids extending schemas that are file-backed (`dataSource="file"`, `mappingType="xmlFile"`). The published list, which Adobe says is not exhaustive:

`xtk:entityBackupNew`, `xtk:entityBackupOriginal`, `xtk:entityOriginal`, `xtk:form`, `xtk:srcSchema`, `ncm:publishing`, `nl:monitoring`, `nms:calendar`, `nms:remoteTracking`, `nms:userAgentRules`, `xtk:builder`, `xtk:connections`, `xtk:dbInit`, `xtk:funcList`, `xtk:fusion`, `xtk:jst`, `xtk:navtree`, `xtk:queryDef`, `xtk:resourceMenu`, `xtk:schema`, `xtk:scriptContext`, `xtk:session`, `xtk:sqlSchema`, `xtk:strings`.

If a task asks to extend one of these, stop and put the data on a custom SQL schema.

## New schema

```xml
<srcSchema namespace="cus" name="loyaltyEvent" label="Loyalty events"
           labelSingular="Loyalty event" mappingType="sql">
  <element name="loyaltyEvent" sqltable="CusLoyaltyEvent" autopk="true">
    <key name="id">
      <keyfield xpath="@id"/>
    </key>
    <attribute name="eventDate" label="Event date" type="datetime"/>
    <attribute name="points" label="Points" type="long"/>
    <element name="recipient" type="link" target="nms:recipient"
             label="Recipient">
      <join xpath-dst="@id" xpath-src="@recipient-id"/>
    </element>
    <dbindex name="recipientDate">
      <keyfield xpath="@recipient-id"/>
      <keyfield xpath="@eventDate"/>
    </dbindex>
  </element>
</srcSchema>
```

`autopk="true"` adds the technical primary key. Set `sqltable` so the physical name is stable. `mappingType="sql"` is the default for data you want in the database. `view="true"` makes a logical view: the database wizard ignores it. Use a view to describe an existing external table, not to store new data.

Attribute types you can rely on: `string` (set `length`), `long`, `short`, `byte`, `double`, `float`, `boolean`, `datetime`, `date`, `time`, `memo`, `html`, `cdata`. A `memo` or `html` value stored as XML is replaced as a document on write; it is not a bag of columns.

## Links

- 1-1 and N-1 links store the foreign key on the source. Query them as `[link/@field]` or `[@link-id]`.
- 1-N links are collections. Filter with `EXISTS`. Selecting the collection in the parent query multiplies rows.
- On write, `_operation="none"` on the linked element reconciles by `_key` without modifying the target.
- A reverse link on `nms:recipient` is an extension. Add it on `cus:recipient`, not by editing `nms:recipient`.

## Keys and indexes

The write engine reconciles on the first schema key whose fields are present in the document, unless `_key` overrides it. Define a real key for any natural identity (`@email` plus folder, an external id). An index is not a key. Add a `<dbindex>` for a filter the workflows actually run, not for every column.

## Forms are a second entity

Operators see an `xtk:form`, not the schema. A new attribute is invisible until the form, the list, and any overview are extended. Extend a built-in form with a form extension in the custom namespace rather than editing the built-in form source.

`visibleIf` and `enabledIf` only change the screen. The client still loads the full entity, and a list configuration can still show the column. For confidential fields, use an overflow schema so unauthorized operators do not receive the values. Enforce row visibility with `sysFilter`. Enforce a method with its `access` attribute set to a named right.

A named right on a navtree command only hides the menu. It does not protect the SOAP call.

## Enumerations

Reuse an existing `xtk:enum` when the value set is already in the data model. Add a new enumeration for a new closed set. Do not store either as a free string if a later split or typology rule has to match it.

## FDA

An external table is a schema whose data source is an FDA external account (`nms:extAccount`). Keep heavy filters on that source. Do not pull a large FDA result into a JavaScript activity or into the local database row by row. A local `nms:recipient` extension is still a local column: FDA does not move it.
