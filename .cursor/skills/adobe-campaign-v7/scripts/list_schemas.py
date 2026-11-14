#!/usr/bin/env python3
"""Log on to Adobe Campaign Classic and list data schemas (xtk:srcSchema).

Reads ACC_URL, ACC_USER, and ACC_PASSWORD from the environment.
Set ACC_TLS_VERIFY=0 for a server whose certificate is not publicly trusted.
"""

from __future__ import annotations

import sys

import acc_soap
from acc_soap import PAGE_SIZE, MAX_PAGES, Session, SoapClient, SoapError


def main() -> int:
    return acc_soap.run_logged_in(list_schemas)


def list_schemas(client: SoapClient, session: Session) -> int:
    schemas = fetch_schemas(client, session)
    print("namespace\tname\tlabel")
    for namespace, name, label in schemas:
        print(f"{namespace}\t{name}\t{label}")
    print(f"{len(schemas)} schemas", file=sys.stderr)
    return 0


def fetch_schemas(client: SoapClient, session: Session) -> list[tuple[str, str, str]]:
    found: list[tuple[str, str, str]] = []
    seen: set[tuple[str, str]] = set()
    for page in range(MAX_PAGES):
        start = page * PAGE_SIZE
        rows = schema_page(client, session, start)
        if not rows:
            break
        fresh = [row for row in rows if (row[0], row[1]) not in seen]
        if not fresh:
            raise SoapError("The server repeated a page of schemas, so the list stopped early.")
        for row in fresh:
            seen.add((row[0], row[1]))
            found.append(row)
        if len(rows) < PAGE_SIZE:
            break
    else:
        raise SoapError(
            f"Stopped after {MAX_PAGES * PAGE_SIZE} schemas. Narrow the query before listing more."
        )
    found.sort()
    return found


def schema_page(client: SoapClient, session: Session, start: int) -> list[tuple[str, str, str]]:
    query = (
        f'<queryDef schema="xtk:srcSchema" operation="select" lineCount="{PAGE_SIZE}"'
        f' startLine="{start}" xtkschema="xtk:queryDef">'
        "<select>"
        '<node expr="@namespace"/>'
        '<node expr="@name"/>'
        '<node expr="@label"/>'
        "</select>"
        "<orderBy>"
        '<node expr="@namespace"/>'
        '<node expr="@name"/>'
        "</orderBy>"
        "</queryDef>"
    )
    root = client.execute_query(session, query)
    rows: list[tuple[str, str, str]] = []
    for node in root.iter():
        if acc_soap.local_name(node.tag) != "srcSchema":
            continue
        namespace = node.get("namespace")
        name = node.get("name")
        if not namespace or not name:
            continue
        rows.append((namespace, name, acc_soap.cell(node.get("label") or "")))
    return rows


if __name__ == "__main__":
    sys.exit(main())
