#!/usr/bin/env python3
"""List Campaign Classic workflow runs that had activity in the past 24 hours.

A run is one execution of a workflow. Campaign stores each activity execution
in xtk:workflowTask, so this script groups those rows. Duration is the time
from the earliest task start to the latest task end.

Reads ACC_URL, ACC_USER, and ACC_PASSWORD from the environment.
Set ACC_TLS_VERIFY=0 for a server whose certificate is not publicly trusted.
"""

from __future__ import annotations

import sys
from dataclasses import dataclass
from datetime import datetime, timedelta

import acc_soap
from acc_soap import PAGE_SIZE, MAX_PAGES, Session, SoapClient, SoapError

_UNSET = datetime.max
# The next activity in one execution is created as the previous one finishes.
# A later start, past this handoff, is treated as another run of the same workflow.
HANDOFF = timedelta(seconds=5)


@dataclass(frozen=True)
class Task:
    workflow: str
    label: str
    activity: str
    task_id: str
    started: datetime | None
    started_raw: str
    completed: datetime | None
    completed_raw: str


@dataclass(frozen=True)
class Run:
    workflow: str
    label: str
    started: datetime | None
    started_raw: str
    ended: datetime | None
    ended_raw: str
    activities: int
    status: str


def main() -> int:
    return acc_soap.run_logged_in(list_runs)


def list_runs(client: SoapClient, session: Session) -> int:
    tasks = fetch_tasks(client, session)
    runs = group_runs(tasks)
    print("workflow\tlabel\tstarted\tended\tduration\tactivities\tstatus")
    for run in runs:
        print(
            "\t".join(
                (
                    acc_soap.cell(run.workflow),
                    acc_soap.cell(run.label),
                    acc_soap.cell(run.started_raw),
                    acc_soap.cell(run.ended_raw),
                    format_duration(run.started, run.ended) if run.status == "completed" else "",
                    str(run.activities),
                    run.status,
                )
            )
        )
    print(f"{len(runs)} workflow runs", file=sys.stderr)
    print(
        "Times are the values Campaign returned. Duration uses tasks that started or "
        "finished in the past 24 hours, so a run that began earlier can look shorter "
        "than the full execution. Tasks older than the workflow History in days are already gone.",
        file=sys.stderr,
    )
    return 0


def fetch_tasks(client: SoapClient, session: Session) -> list[Task]:
    found: list[Task] = []
    seen: set[tuple[str, str, str, str]] = set()
    for page in range(MAX_PAGES):
        rows = task_page(client, session, page * PAGE_SIZE)
        if not rows:
            break
        fresh = [row for row in rows if task_key(row) not in seen]
        if not fresh:
            raise SoapError("The server repeated a page of workflow tasks, so the list stopped early.")
        for row in fresh:
            seen.add(task_key(row))
            found.append(row)
        if len(rows) < PAGE_SIZE:
            break
    else:
        raise SoapError(
            f"Stopped after {MAX_PAGES * PAGE_SIZE} workflow tasks. Narrow the query before listing more."
        )
    return found


def task_key(task: Task) -> tuple[str, str, str, str]:
    return (task.workflow, task.task_id, task.activity, task.started_raw)


def task_page(client: SoapClient, session: Session, start: int) -> list[Task]:
    query = (
        f'<queryDef schema="xtk:workflowTask" operation="select" lineCount="{PAGE_SIZE}"'
        f' startLine="{start}" xtkschema="xtk:queryDef">'
        "<select>"
        '<node expr="[workflow/@internalName]" alias="@workflowName"/>'
        '<node expr="[workflow/@label]" alias="@workflowLabel"/>'
        '<node expr="@activity"/>'
        '<node expr="@creationDate"/>'
        '<node expr="@completionDate"/>'
        '<node expr="@id"/>'
        "</select>"
        "<where>"
        '<condition expr="@creationDate &gt;= AddHours(GetDate(), -24)"/>'
        '<condition boolOperator="OR" expr="@completionDate &gt;= AddHours(GetDate(), -24)"/>'
        "</where>"
        "<orderBy>"
        '<node expr="@creationDate"/>'
        '<node expr="@id"/>'
        "</orderBy>"
        "</queryDef>"
    )
    root = client.execute_query(session, query)
    rows: list[Task] = []
    for node in root.iter():
        if acc_soap.local_name(node.tag) != "workflowTask":
            continue
        workflow = node.get("workflowName") or ""
        label = node.get("workflowLabel") or ""
        if not workflow:
            for child in node:
                if acc_soap.local_name(child.tag) != "workflow":
                    continue
                workflow = child.get("internalName") or ""
                label = label or child.get("label") or ""
        if not workflow:
            continue
        started_raw = node.get("creationDate") or ""
        completed_raw = node.get("completionDate") or ""
        rows.append(
            Task(
                workflow=workflow,
                label=label,
                activity=node.get("activity") or "",
                task_id=node.get("id") or "",
                started=parse_acc_datetime(started_raw),
                started_raw=started_raw,
                completed=parse_acc_datetime(completed_raw),
                completed_raw=completed_raw,
            )
        )
    return rows


def group_runs(tasks: list[Task]) -> list[Run]:
    grouped: dict[str, list[Task]] = {}
    labels: dict[str, str] = {}
    for task in tasks:
        grouped.setdefault(task.workflow, []).append(task)
        if task.label and not labels.get(task.workflow):
            labels[task.workflow] = task.label

    runs: list[Run] = []
    for workflow, items in grouped.items():
        items.sort(key=lambda task: (task.started or _UNSET, task.task_id, task.activity))
        current: list[Task] = []
        for task in items:
            if current and starts_new_run(current, task):
                runs.append(make_run(workflow, labels.get(workflow, ""), current))
                current = [task]
            else:
                current.append(task)
        if current:
            runs.append(make_run(workflow, labels.get(workflow, ""), current))
    runs.sort(key=lambda run: (run.started or _UNSET, run.workflow, run.started_raw))
    return runs


def starts_new_run(tasks: list[Task], task: Task) -> bool:
    if task.started is None or not run_completed(tasks):
        return False
    finished = run_end(tasks)
    if (task.started.tzinfo is None) != (finished.tzinfo is None):
        return False
    return task.started > finished + HANDOFF


def run_completed(tasks: list[Task]) -> bool:
    return all(task.completed is not None for task in tasks)


def run_end(tasks: list[Task]) -> datetime:
    completed = [task.completed for task in tasks if task.completed is not None]
    return max(completed)


def make_run(workflow: str, label: str, tasks: list[Task]) -> Run:
    started_task = min(tasks, key=lambda task: (task.started or _UNSET, task.started_raw))
    completed = run_completed(tasks)
    if completed:
        ended_task = max(tasks, key=lambda task: (task.completed or _UNSET, task.completed_raw))
        ended = ended_task.completed
        ended_raw = ended_task.completed_raw
        status = "completed"
    else:
        ended = None
        ended_raw = ""
        status = "running"
    return Run(
        workflow=workflow,
        label=label,
        started=started_task.started,
        started_raw=started_task.started_raw,
        ended=ended,
        ended_raw=ended_raw,
        activities=len(tasks),
        status=status,
    )


def parse_acc_datetime(value: str) -> datetime | None:
    text = value.strip().strip("#")
    if not text:
        return None
    text = text.replace(" ", "T")
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        return datetime.fromisoformat(text)
    except ValueError:
        return None


def format_duration(started: datetime | None, ended: datetime | None) -> str:
    if started is None or ended is None:
        return ""
    if (started.tzinfo is None) != (ended.tzinfo is None):
        return ""
    total = int((ended - started).total_seconds())
    sign = "-" if total < 0 else ""
    remaining = abs(total)
    days, remaining = divmod(remaining, 86400)
    hours, remaining = divmod(remaining, 3600)
    minutes, seconds = divmod(remaining, 60)
    parts: list[str] = []
    if days:
        parts.append(f"{days}d")
    if days or hours:
        parts.append(f"{hours}h")
    if days or hours or minutes:
        parts.append(f"{minutes}m")
    parts.append(f"{seconds}s")
    return sign + " ".join(parts)


if __name__ == "__main__":
    sys.exit(main())
