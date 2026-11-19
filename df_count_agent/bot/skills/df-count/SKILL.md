---
description: Use when counting Unica derived fields per process box from flowchart XML reports.
---

# Count derived fields

1. Call `count_derived_fields`. Pass `fileName` only when the user names one XML file.
2. For each file, list every process box, its type, `derivedFieldCount`, and each field name. Put `(persistent)` after a persistent field.
3. Give `totalDerivedFields` for the file and `distinctDerivedFieldNames` when the same name appears in more than one box.
4. If `error` is set, report that file as unreadable and continue with the others.
5. If `notes` say no derived-field elements were found, quote `observedTags` and stop. Do not guess a count.

The reports are the XML files from `unica_acsesutil -r`. Put them in the directory named by `DF_XML_DIR`. The sample reports live in `fixtures/xml` when that variable is unset.

A field listed under `DerivedFields`, or a `DerivedField` element on a `Process`, `ProcessBox`, or `FlowchartProcess`, counts for that box. An output `Field` outside `DerivedFields` does not count.
