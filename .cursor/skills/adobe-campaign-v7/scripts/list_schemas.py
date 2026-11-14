#!/usr/bin/env python3
"""Log on to Adobe Campaign Classic and list data schemas (xtk:srcSchema).

Reads ACC_URL, ACC_USER, and ACC_PASSWORD from the environment.
Set ACC_TLS_VERIFY=0 for a server whose certificate is not publicly trusted.
"""

from __future__ import annotations

import os
import ssl
import sys
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from urllib.parse import urlsplit, urlunsplit

PAGE_SIZE = 200
MAX_PAGES = 100
SOAP_URL_PATH = "/nl/jsp/soaprouter.jsp"


def main() -> int:
    url = os.environ.get("ACC_URL", "").strip()
    user = os.environ.get("ACC_USER", "").strip()
    password = os.environ.get("ACC_PASSWORD", "")
    missing = [
        name
        for name, value in (
            ("ACC_URL", url),
            ("ACC_USER", user),
            ("ACC_PASSWORD", password),
        )
        if value == ""
    ]
    if missing:
        print("Set " + ", ".join(missing) + " and run again.", file=sys.stderr)
        return 2

    try:
        endpoint = soap_endpoint(url)
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        return 2

    client = SoapClient(endpoint, tls_context())
    try:
        session = client.logon(user, password)
        print(session.summary(), file=sys.stderr)
        schemas = client.list_src_schemas(session)
    except SoapError as exc:
        print(str(exc), file=sys.stderr)
        return 1
    finally:
        client.logoff()

    print("namespace\tname\tlabel")
    for namespace, name, label in schemas:
        print(f"{namespace}\t{name}\t{label}")
    print(f"{len(schemas)} schemas", file=sys.stderr)
    return 0


class Session:
    def __init__(self, token: str, security_token: str, info: ET.Element | None):
        self.token = token
        self.security_token = security_token
        self.info = info

    def summary(self) -> str:
        if self.info is None:
            return "Connected"
        instance = self.info.get("instanceName") or "unknown instance"
        release = self.info.get("releaseName") or "unknown release"
        build = self.info.get("buildNumber") or "unknown build"
        return f"Connected to {instance} (Campaign {release}, build {build})"


class SoapError(Exception):
    pass


class SoapClient:
    def __init__(self, endpoint: str, context: ssl.SSLContext):
        self.endpoint = endpoint
        self.context = context
        self.session: Session | None = None

    def logon(self, user: str, password: str) -> Session:
        body = (
            '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"'
            ' xmlns:urn="urn:xtk:session">'
            "<soapenv:Header/><soapenv:Body><urn:Logon>"
            "<urn:sessiontoken></urn:sessiontoken>"
            f"<urn:strLogin>{xml_text(user)}</urn:strLogin>"
            f"<urn:strPassword>{xml_text(password)}</urn:strPassword>"
            "<urn:elemParameters></urn:elemParameters>"
            "</urn:Logon></soapenv:Body></soapenv:Envelope>"
        )
        status, headers, payload = self._post("xtk:session#Logon", body)
        root = parse_payload(status, payload)
        token = text_of(root, "pstrSessionToken") or cookie_value(headers, "__sessiontoken")
        security = header_value(headers, "X-Security-Token") or text_of(root, "pstrSecurityToken")
        if not token:
            raise SoapError("Logon succeeded but the response had no session token.")
        info = find_first(root, "serverInfo")
        self.session = Session(token, security, info)
        return self.session

    def list_src_schemas(self, session: Session) -> list[tuple[str, str, str]]:
        found: list[tuple[str, str, str]] = []
        seen: set[tuple[str, str]] = set()
        for page in range(MAX_PAGES):
            start = page * PAGE_SIZE
            rows = self._schema_page(session, start)
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

    def logoff(self) -> None:
        session = self.session
        if session is None:
            return
        self.session = None
        body = (
            '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"'
            ' xmlns:urn="urn:xtk:session">'
            "<soapenv:Header/><soapenv:Body><urn:Logoff>"
            f"<urn:sessiontoken>{xml_text(session.token)}</urn:sessiontoken>"
            "</urn:Logoff></soapenv:Body></soapenv:Envelope>"
        )
        try:
            self._post(
                "xtk:session#Logoff",
                body,
                session_token=session.token,
                security_token=session.security_token,
            )
        except SoapError:
            return

    def _schema_page(self, session: Session, start: int) -> list[tuple[str, str, str]]:
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
        body = (
            '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"'
            ' xmlns:urn="urn:xtk:queryDef">'
            "<soapenv:Header/><soapenv:Body><urn:ExecuteQuery>"
            f"<urn:sessiontoken>{xml_text(session.token)}</urn:sessiontoken>"
            f"<urn:entity>{query}</urn:entity>"
            "</urn:ExecuteQuery></soapenv:Body></soapenv:Envelope>"
        )
        status, _headers, payload = self._post(
            "xtk:queryDef#ExecuteQuery",
            body,
            session_token=session.token,
            security_token=session.security_token,
        )
        root = parse_payload(status, payload)
        rows: list[tuple[str, str, str]] = []
        for node in root.iter():
            if local_name(node.tag) != "srcSchema":
                continue
            namespace = node.get("namespace")
            name = node.get("name")
            if not namespace or not name:
                continue
            label = (node.get("label") or "").replace("\t", " ").replace("\n", " ").replace("\r", " ")
            rows.append((namespace, name, label))
        return rows

    def _post(
        self,
        action: str,
        body: str,
        session_token: str = "",
        security_token: str = "",
    ) -> tuple[int, object, bytes]:
        headers = {
            "Content-Type": "text/xml; charset=utf-8",
            "SOAPAction": action,
        }
        if session_token:
            headers["Cookie"] = "__sessiontoken=" + session_token
        if security_token:
            headers["X-Security-Token"] = security_token
        request = urllib.request.Request(
            self.endpoint,
            data=body.encode("utf-8"),
            headers=headers,
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=60, context=self.context) as response:
                return response.status, response.headers, response.read()
        except urllib.error.HTTPError as exc:
            return exc.code, exc.headers, exc.read()
        except urllib.error.URLError as exc:
            raise SoapError(f"Could not reach {self.endpoint}: {exc.reason}") from exc


def soap_endpoint(url: str) -> str:
    parts = urlsplit(url)
    if parts.username or parts.password:
        raise ValueError("Put the login and password in ACC_USER and ACC_PASSWORD, not in the URL.")
    if parts.scheme not in ("https", "http") or not parts.hostname:
        raise ValueError("ACC_URL must be an http or https URL, such as https://campaign.example.com.")
    path = parts.path.rstrip("/")
    if not path.endswith("soaprouter.jsp"):
        path = (path + SOAP_URL_PATH) if path else SOAP_URL_PATH
    return urlunsplit((parts.scheme, parts.netloc, path, "", ""))


def tls_context() -> ssl.SSLContext:
    verify = os.environ.get("ACC_TLS_VERIFY", "1").strip().lower()
    if verify in ("0", "false", "no"):
        context = ssl._create_unverified_context()
        return context
    return ssl.create_default_context()


def parse_payload(status: int, payload: bytes) -> ET.Element:
    text = payload.decode("utf-8", errors="replace").strip()
    if text.startswith("<?xml"):
        text = text.split("?>", 1)[1].strip()
    if not text:
        raise SoapError(f"Empty response (HTTP {status}).")
    try:
        root = ET.fromstring(text)
    except ET.ParseError as exc:
        raise SoapError(f"Response was not XML (HTTP {status}).") from exc
    fault = find_first(root, "faultstring")
    if fault is not None and (fault.text or "").strip():
        raise SoapError(fault.text.strip())
    return root


def text_of(root: ET.Element, name: str) -> str:
    node = find_first(root, name)
    if node is None or node.text is None:
        return ""
    return node.text.strip()


def find_first(root: ET.Element, name: str) -> ET.Element | None:
    for node in root.iter():
        if local_name(node.tag) == name:
            return node
    return None


def local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def header_value(headers: object, name: str) -> str:
    getter = getattr(headers, "get", None)
    if getter is None:
        return ""
    value = getter(name)
    return value.strip() if isinstance(value, str) else ""


def cookie_value(headers: object, name: str) -> str:
    get_all = getattr(headers, "get_all", None)
    values = get_all("Set-Cookie") if get_all else None
    if not values:
        single = header_value(headers, "Set-Cookie")
        values = [single] if single else []
    prefix = name + "="
    for value in values:
        for part in value.split(";"):
            item = part.strip()
            if item.startswith(prefix):
                return item[len(prefix):]
    return ""


def xml_text(value: str) -> str:
    return (
        value.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&apos;")
    )


if __name__ == "__main__":
    sys.exit(main())
