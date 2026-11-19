import { readdir, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";

const FIELD_ELEMENTS = new Set([
  "derivedfield",
  "persistentderivedfield",
  "userderivedfield",
  "derivedfld",
  "dfield",
]);

const FIELD_CONTAINERS = new Set([
  "derivedfields",
  "persistentderivedfields",
  "userderivedfields",
]);

const PROCESS_ELEMENTS = new Set(["process", "processbox", "flowchartprocess"]);

const NAME_TAGS = new Set(["name", "processname", "fieldname", "boxname"]);
const TYPE_TAGS = new Set(["type", "processtype"]);
const EXPR_TAGS = new Set(["expression", "expr", "formula", "predicateexpr"]);

export type DerivedField = {
  name: string;
  expression: string;
  persistent: boolean;
};

export type ProcessBoxCount = {
  processName: string;
  processType: string | null;
  derivedFieldCount: number;
  fields: DerivedField[];
};

export type FlowchartCount = {
  flowchartName: string | null;
  boxes: ProcessBoxCount[];
  totalDerivedFields: number;
  distinctDerivedFieldNames: string[];
  observedTags: string[];
  notes: string[];
};

type Frame = {
  local: string;
  attrs: Record<string, string>;
  texts: string[];
  ownName: string | null;
  ownType: string | null;
  ownExpr: string | null;
  fields: DerivedField[];
};

type FileCount = FlowchartCount & {
  fileName: string;
  error: string | null;
};

export function countFlowchartXml(xml: string): FlowchartCount {
  const observed = new Set<string>();
  const boxes: ProcessBoxCount[] = [];
  const outside: DerivedField[] = [];
  let flowchartName: string | null = null;
  const stack: Frame[] = [];

  tokenize(xml, {
    start(local, attrs, selfClosing) {
      observed.add(local);
      stack.push({
        local,
        attrs,
        texts: [],
        ownName: null,
        ownType: null,
        ownExpr: null,
        fields: [],
      });
      if (selfClosing) {
        finish(stack, boxes, outside, (name) => {
          flowchartName ??= name;
        });
      }
    },
    end(local) {
      const current = stack[stack.length - 1];
      if (!current || current.local !== local) {
        throw new Error(`Unbalanced end tag ${local}.`);
      }
      finish(stack, boxes, outside, (name) => {
        flowchartName ??= name;
      });
    },
    text(value) {
      const current = stack[stack.length - 1];
      if (current && value.trim()) current.texts.push(value);
    },
  });

  if (stack.length > 0) throw new Error("The XML ended before every tag was closed.");

  if (outside.length > 0) {
    boxes.push({
      processName: "(outside a process box)",
      processType: null,
      derivedFieldCount: outside.length,
      fields: outside,
    });
  }

  const names = boxes.flatMap((box) => box.fields.map((field) => field.name));
  const distinct = [...new Map(names.map((name) => [name.toLowerCase(), name])).values()];
  const notes: string[] = [];
  if (boxes.length === 0) {
    notes.push(
      "No process boxes were found. Expected Process, ProcessBox, or FlowchartProcess elements.",
    );
  }
  const fieldCount = boxes.reduce((sum, box) => sum + box.derivedFieldCount, 0);
  if (fieldCount === 0) {
    notes.push(
      "No derived-field elements were found. Expected DerivedField under a process box, or Field under DerivedFields.",
    );
  }

  return {
    flowchartName,
    boxes,
    totalDerivedFields: fieldCount,
    distinctDerivedFieldNames: distinct,
    observedTags: [...observed].sort(),
    notes,
  };
}

export async function countXmlFiles(directory: string, fileName?: string): Promise<{
  directory: string;
  files: FileCount[];
  notes: string[];
}> {
  const notes: string[] = [];
  let root: string;
  try {
    const info = await stat(directory);
    if (!info.isDirectory()) {
      return { directory, files: [], notes: [`${directory} is not a directory.`] };
    }
    root = await realpath(directory);
  } catch {
    return { directory, files: [], notes: [`XML directory does not exist: ${directory}`] };
  }

  const wanted = fileName ? [fileName] : (await readdir(root)).filter((name) => name.toLowerCase().endsWith(".xml")).sort();
  if (wanted.length === 0) notes.push("No XML files were found in the directory.");

  const files: FileCount[] = [];
  for (const name of wanted) {
    if (path.basename(name) !== name) {
      files.push(emptyFile(name, "Pass the XML file name only, not a path."));
      continue;
    }
    const full = path.join(root, name);
    let body: string;
    try {
      const fileReal = await realpath(full);
      if (!isInside(root, fileReal)) {
        files.push(emptyFile(name, "The file is outside the XML directory."));
        continue;
      }
      body = await readFile(fileReal, "utf8");
    } catch {
      files.push(emptyFile(name, "The XML file could not be read."));
      continue;
    }
    try {
      files.push({ fileName: name, error: null, ...countFlowchartXml(body) });
    } catch (error) {
      const message = error instanceof Error ? error.message : "The XML could not be parsed.";
      files.push(emptyFile(name, message));
    }
  }

  return { directory: root, files, notes };
}

function finish(
  stack: Frame[],
  boxes: ProcessBoxCount[],
  outside: DerivedField[],
  setFlowchartName: (name: string) => void,
): void {
  const frame = stack.pop();
  if (!frame) return;
  const parent = stack[stack.length - 1];
  const text = frame.texts.join(" ").replace(/\s+/g, " ").trim();
  if (parent && text) {
    if (NAME_TAGS.has(frame.local) && parent.ownName == null) parent.ownName = text;
    if (TYPE_TAGS.has(frame.local) && parent.ownType == null) parent.ownType = text;
    if (EXPR_TAGS.has(frame.local) && parent.ownExpr == null) parent.ownExpr = text;
  }

  if ((frame.local === "flowchart" || frame.local === "flowchartreport") && flowchartLabel(frame)) {
    setFlowchartName(flowchartLabel(frame));
  }

  if (isDerivedField(frame, stack)) {
    const field = toField(frame, stack);
    const owner = [...stack].reverse().find((item) => PROCESS_ELEMENTS.has(item.local));
    if (owner) owner.fields.push(field);
    else outside.push(field);
  }

  if (PROCESS_ELEMENTS.has(frame.local)) {
    boxes.push({
      processName: frame.attrs.name ?? frame.attrs.processname ?? frame.ownName ?? "(unnamed process)",
      processType: frame.attrs.type ?? frame.attrs.processtype ?? frame.ownType,
      derivedFieldCount: frame.fields.length,
      fields: frame.fields,
    });
  }
}

function flowchartLabel(frame: Frame): string {
  return frame.attrs.name ?? frame.ownName ?? "";
}

function isDerivedField(frame: Frame, ancestors: Frame[]): boolean {
  if (FIELD_ELEMENTS.has(frame.local)) return true;
  return frame.local === "field" && ancestors.some((item) => FIELD_CONTAINERS.has(item.local));
}

function toField(frame: Frame, ancestors: Frame[]): DerivedField {
  const persistent =
    isYes(frame.attrs.persistent) ||
    isYes(frame.attrs.makepersistent) ||
    isYes(frame.attrs.ispersistent) ||
    frame.local.startsWith("persistent") ||
    ancestors.some((item) => item.local.startsWith("persistent"));
  const name = frame.attrs.name ?? frame.attrs.fieldname ?? frame.ownName ?? "(unnamed)";
  const expression = (frame.attrs.expression ?? frame.attrs.expr ?? frame.ownExpr ?? "").slice(0, 500);
  return { name, expression, persistent };
}

function isYes(value: string | undefined): boolean {
  return value != null && /^(1|true|yes|y)$/i.test(value);
}

function emptyFile(fileName: string, error: string): FileCount {
  return {
    fileName,
    error,
    flowchartName: null,
    boxes: [],
    totalDerivedFields: 0,
    distinctDerivedFieldNames: [],
    observedTags: [],
    notes: [],
  };
}

function isInside(root: string, target: string): boolean {
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  return target === root || target.startsWith(prefix);
}

type TokenHandlers = {
  start: (local: string, attrs: Record<string, string>, selfClosing: boolean) => void;
  end: (local: string) => void;
  text: (value: string) => void;
};

function tokenize(xml: string, handlers: TokenHandlers): void {
  let index = xml.charCodeAt(0) === 0xfeff ? 1 : 0;
  while (index < xml.length) {
    if (xml.startsWith("<!--", index)) {
      const end = xml.indexOf("-->", index + 4);
      if (end < 0) throw new Error("Unclosed comment.");
      index = end + 3;
      continue;
    }
    if (xml.startsWith("<?", index)) {
      const end = xml.indexOf("?>", index + 2);
      if (end < 0) throw new Error("Unclosed declaration.");
      index = end + 2;
      continue;
    }
    if (xml.startsWith("<![CDATA[", index)) {
      const end = xml.indexOf("]]>", index + 9);
      if (end < 0) throw new Error("Unclosed CDATA.");
      handlers.text(xml.slice(index + 9, end));
      index = end + 3;
      continue;
    }
    if (xml.startsWith("</", index)) {
      const end = xml.indexOf(">", index + 2);
      if (end < 0) throw new Error("Unclosed end tag.");
      handlers.end(localName(xml.slice(index + 2, end).trim()));
      index = end + 1;
      continue;
    }
    if (xml[index] === "<") {
      const parsed = readStartTag(xml, index);
      handlers.start(parsed.local, parsed.attrs, parsed.selfClosing);
      index = parsed.next;
      continue;
    }
    const next = xml.indexOf("<", index);
    const chunk = xml.slice(index, next === -1 ? xml.length : next);
    if (chunk.trim()) handlers.text(decode(chunk));
    index = next === -1 ? xml.length : next;
  }
}

function readStartTag(xml: string, start: number): {
  local: string;
  attrs: Record<string, string>;
  selfClosing: boolean;
  next: number;
} {
  let index = start + 1;
  const nameStart = index;
  while (index < xml.length && !/[\s/>]/.test(xml[index] ?? "")) index += 1;
  const qname = xml.slice(nameStart, index);
  if (!qname) throw new Error("Missing tag name.");
  const attrs: Record<string, string> = {};
  let selfClosing = false;
  while (index < xml.length) {
    while (index < xml.length && /\s/.test(xml[index] ?? "")) index += 1;
    if (xml.startsWith("/>", index)) {
      selfClosing = true;
      index += 2;
      break;
    }
    if (xml[index] === ">") {
      index += 1;
      break;
    }
    const attrStart = index;
    while (index < xml.length && !/[\s=/>]/.test(xml[index] ?? "")) index += 1;
    const attrName = localName(xml.slice(attrStart, index));
    while (index < xml.length && /\s/.test(xml[index] ?? "")) index += 1;
    if (xml[index] !== "=") throw new Error(`Expected = after ${attrName}.`);
    index += 1;
    while (index < xml.length && /\s/.test(xml[index] ?? "")) index += 1;
    const quote = xml[index];
    if (quote !== '"' && quote !== "'") throw new Error(`Unquoted attribute ${attrName}.`);
    index += 1;
    const valueStart = index;
    while (index < xml.length && xml[index] !== quote) index += 1;
    if (index >= xml.length) throw new Error(`Unclosed attribute ${attrName}.`);
    attrs[attrName] = decode(xml.slice(valueStart, index));
    index += 1;
  }
  return { local: localName(qname), attrs, selfClosing, next: index };
}

function localName(qname: string): string {
  const separator = qname.lastIndexOf(":");
  return (separator === -1 ? qname : qname.slice(separator + 1)).trim().toLowerCase();
}

function decode(value: string): string {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}
