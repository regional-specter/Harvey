"""Interactive Rich TUI. See CONTEXT.md §11."""

from __future__ import annotations

import argparse
import select
import subprocess
import sys
import termios
import tty
from pathlib import Path
from queue import Empty, SimpleQueue
from threading import Event, Thread

from dotenv import load_dotenv
from rich.console import Console
from rich.live import Live

from harvey.cli import theme
from harvey.cli.backend import SEMICONDUCTOR_QUERY, iter_demo_events, run_live_turn
from harvey.cli.render import build_layout
from harvey.cli.state import TableData, ToolTrace, Turn, UiState
from harvey.graph.events import UiEvent
from harvey.memory.store import get_store

ROOT = Path(__file__).resolve().parents[2]


class RawTerminal:
    def __init__(self, fd: int) -> None:
        self.fd = fd
        self._old: list | None = None

    def __enter__(self) -> RawTerminal:
        self._old = termios.tcgetattr(self.fd)
        tty.setcbreak(self.fd)
        return self

    def __exit__(self, *exc: object) -> None:
        if self._old is not None:
            termios.tcsetattr(self.fd, termios.TCSADRAIN, self._old)


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="harvey")
    parser.add_argument("--demo", action="store_true", help="Canned traces, no API keys required")
    parser.add_argument(
        "--dump",
        choices=("home", "session"),
        help="Print a static layout frame and exit",
    )
    args = parser.parse_args(argv)

    load_dotenv(ROOT / ".env")
    state = new_state()

    if args.dump:
        dump_frame(args.dump, state)
        return

    if not sys.stdin.isatty() or not sys.stdout.isatty():
        print("Harvey needs an interactive terminal. Use --dump home to preview the layout.", file=sys.stderr)
        sys.exit(1)

    run_tui(state, demo=args.demo)


def new_state() -> UiState:
    cwd = Path.cwd()
    return UiState(
        cwd_label=_abbrev_path(cwd),
        git_branch=_git_branch(cwd),
        model_label=theme.MODEL_LABEL,
    )


def dump_frame(kind: str, state: UiState) -> None:
    console = Console(
        force_terminal=True,
        color_system="truecolor",
        width=88,
        height=48,
        style=f"{theme.TEXT} on {theme.BG}",
    )
    if kind == "session":
        _seed_session(state)
    console.print(build_layout(state, console.size.width, console.size.height))


def _seed_session(state: UiState) -> None:
    state.turns.append(
        Turn(
            query=SEMICONDUCTOR_QUERY,
            tools=[
                ToolTrace(
                    name="Financials",
                    args="Gross margin, operating margin, and net margin for AVGO, MRVL, AMD, INTC",
                    details=[
                        "Called 4 data sources in 7.3s",
                        "Called 4 data sources in 18.5s",
                    ],
                )
            ],
            thought="Let me get the actual margin percentages for a cleaner comparison.",
            answer="AVGO wins across the board. It's not particularly close.",
            table=TableData(
                headers=["Ticker", "Gross Margin", "Op Margin", "Net Margin"],
                rows=[
                    ["AVGO", "67.8%", "41.8%", "36.6%"],
                    ["MRVL", "51.0%", "39.7%", "32.6%"],
                    ["AMD", "49.5%", "12.6%", "12.5%"],
                    ["INTC", "34.8%", "-3.8%", "-0.5%"],
                ],
            ),
            complete=True,
        )
    )


def run_tui(state: UiState, *, demo: bool) -> None:
    get_store()
    console = Console(color_system="truecolor", style=f"{theme.TEXT} on {theme.BG}")
    events: SimpleQueue[UiEvent | object] = SimpleQueue()
    stop = Event()
    session: dict[str, object] = {"previous_turn": {}}
    worker: Thread | None = None

    def start_turn(query: str) -> None:
        nonlocal worker
        state.running = True
        state.history.append(query)
        state.history_index = None
        state.input_text = ""
        state.cursor = 0
        state.turns.append(Turn(query=query))
        worker = Thread(
            target=_run_backend,
            args=(query, events, stop, session, state.research_mode, demo),
            daemon=True,
        )
        worker.start()

    with RawTerminal(sys.stdin.fileno()), Live(
        build_layout(state, console.size.width, console.size.height),
        console=console,
        screen=True,
        refresh_per_second=24,
        transient=False,
    ) as live:
        if demo:
            start_turn(SEMICONDUCTOR_QUERY)

        while not stop.is_set():
            _drain_events(state, events)
            live.update(build_layout(state, console.size.width, console.size.height))

            key = _read_key(0.04)
            if key is None:
                continue
            key = _normalize_key(key)
            if key is None:
                continue
            if key in ("\x03", "\x04", "\x11"):  # ctrl+c / ctrl+d / ctrl+q
                stop.set()
                break

            if state.palette_open:
                if _handle_palette(state, key):
                    stop.set()
                    break
                continue

            if key == "\x10":  # ctrl+p
                state.palette_open = True
                state.palette_index = 0
                continue
            if key == "\t":
                modes = theme.RESEARCH_MODES
                idx = modes.index(state.research_mode) if state.research_mode in modes else 0
                state.research_mode = modes[(idx + 1) % len(modes)]
                continue
            if state.running:
                continue
            if key in ("\r", "\n"):
                submitted = state.input_text.strip()
                if submitted.lower() in ("/quit", "/exit", "/q"):
                    stop.set()
                    break
                if submitted:
                    start_turn(submitted)
                continue
            _handle_edit(state, key)


def _run_backend(
    query: str,
    events: SimpleQueue,
    stop: Event,
    session: dict,
    research_mode: str,
    demo: bool,
) -> None:
    try:
        if demo:
            for item in iter_demo_events(query):
                if stop.is_set():
                    return
                if item is not None:
                    events.put(item)
        else:
            def emit(ev: UiEvent) -> None:
                if not stop.is_set():
                    events.put(ev)

            result = run_live_turn(
                query,
                emit,
                previous_turn=session.get("previous_turn") or {},
                research_mode=research_mode,
            )
            session["previous_turn"] = {
                "user_input": query,
                "llm_response": result.get("response"),
                "thematic_scope": result.get("thematic_scope"),
                "intents": result.get("intents"),
                "entities": result.get("entities"),
            }
        events.put({"type": "_done"})
    except Exception as exc:  # noqa: BLE001 — surface anything to the TUI
        events.put({"type": "error", "text": str(exc)})
        events.put({"type": "_done"})


def _drain_events(state: UiState, events: SimpleQueue) -> None:
    while True:
        try:
            ev = events.get_nowait()
        except Empty:
            return
        _apply_event(state, ev)  # type: ignore[arg-type]


def _apply_event(state: UiState, ev: UiEvent) -> None:
    kind = ev.get("type")
    turn = state.active_turn
    if kind == "_done":
        if turn:
            turn.complete = True
            for tool in turn.tools:
                tool.running = False
        state.running = False
        return
    if turn is None:
        return
    if kind == "tool_start":
        turn.tools.append(
            ToolTrace(name=str(ev.get("name") or "Tool"), args=str(ev.get("args") or ""), running=True)
        )
    elif kind == "tool_detail":
        name = ev.get("name")
        tool = _find_tool(turn, name, ev.get("args")) or (turn.tools[-1] if turn.tools else None)
        if tool and ev.get("detail"):
            tool.details.append(str(ev["detail"]))
    elif kind == "tool_done":
        tool = _find_tool(turn, ev.get("name"), ev.get("args")) or (turn.tools[-1] if turn.tools else None)
        if tool:
            tool.running = False
            tool.duration_ms = ev.get("duration_ms")
            if ev.get("error"):
                tool.error = str(ev["error"])
    elif kind == "thought":
        turn.thought = str(ev.get("text") or "")
    elif kind == "answer":
        turn.answer = str(ev.get("text") or "")
    elif kind == "table":
        turn.table = TableData(headers=list(ev.get("headers") or []), rows=list(ev.get("rows") or []))
    elif kind == "error":
        turn.answer = str(ev.get("text") or "Something went wrong.")
        turn.complete = True
        state.running = False


def _find_tool(turn: Turn, name: str | None, args: str | None = None) -> ToolTrace | None:
    if not name:
        return None
    for tool in reversed(turn.tools):
        if tool.name == name and (args is None or tool.args == args):
            return tool
    return None


def _handle_palette(state: UiState, key: str) -> bool:
    """Handle palette keys. Return True if the app should quit."""
    if key in ("\x1b", "\x10"):
        state.palette_open = False
        return False
    if key in ("\x1b[A", "k"):
        state.palette_index = max(0, state.palette_index - 1)
        return False
    if key in ("\x1b[B", "j"):
        state.palette_index = min(len(theme.COMMANDS) - 1, state.palette_index + 1)
        return False
    if key in ("\r", "\n"):
        cmd = theme.COMMANDS[state.palette_index][0]
        state.palette_open = False
        if cmd in ("/quit", "/exit"):
            return True
        state.input_text = cmd
        state.cursor = len(cmd)
        return False
    return False


def _handle_edit(state: UiState, key: str) -> None:
    text = state.input_text
    cursor = state.cursor
    if key in ("\x7f", "\b"):
        if cursor > 0:
            state.input_text = text[: cursor - 1] + text[cursor:]
            state.cursor = cursor - 1
        return
    if key == "\x1b[D":
        state.cursor = max(0, cursor - 1)
        return
    if key == "\x1b[C":
        state.cursor = min(len(text), cursor + 1)
        return
    if key == "\x1b[A":
        if not state.history:
            return
        idx = len(state.history) - 1 if state.history_index is None else max(0, state.history_index - 1)
        state.history_index = idx
        state.input_text = state.history[idx]
        state.cursor = len(state.input_text)
        return
    if key == "\x1b[B":
        if state.history_index is None:
            return
        if state.history_index >= len(state.history) - 1:
            state.history_index = None
            state.input_text = ""
            state.cursor = 0
            return
        state.history_index += 1
        state.input_text = state.history[state.history_index]
        state.cursor = len(state.input_text)
        return
    if key == "\x1b[3~":
        state.input_text = text[:cursor] + text[cursor + 1 :]
        return
    if key.startswith("\x1b"):
        return
    if len(key) != 1 or not key.isprintable() or key == "\x7f":
        return
    state.input_text = text[:cursor] + key + text[cursor:]
    state.cursor = cursor + 1
    state.history_index = None


def _wait_stdin(timeout: float) -> bool:
    return bool(select.select([sys.stdin], [], [], timeout)[0])


def _read_key(timeout: float) -> str | None:
    """Read one key or a full ANSI sequence so scroll/mouse never leak as text."""
    if not _wait_stdin(timeout):
        return None
    ch = sys.stdin.read(1)
    if ch != "\x1b":
        return ch
    return _read_escape()


def _read_escape() -> str:
    seq = "\x1b"
    if not _wait_stdin(0.08):
        return seq
    seq += sys.stdin.read(1)
    if seq == "\x1bO":
        if _wait_stdin(0.08):
            seq += sys.stdin.read(1)
        return seq
    if seq != "\x1b[":
        return seq
    while _wait_stdin(0.08):
        char = sys.stdin.read(1)
        seq += char
        if seq.startswith("\x1b[M"):
            while len(seq) < 6 and _wait_stdin(0.08):
                seq += sys.stdin.read(1)
            return seq
        if seq.startswith("\x1b[<"):
            if char in "Mm":
                return seq
            continue
        if "@" <= char <= "~":
            return seq
    return seq


def _normalize_key(key: str) -> str | None:
    """Canonicalize arrows; drop mouse, focus, and other non-keys."""
    if key.startswith("\x1b[<") or key.startswith("\x1b[M"):
        return None
    if key in ("\x1b[I", "\x1b[O"):
        return None
    mapped = {
        "\x1bOA": "\x1b[A",
        "\x1bOB": "\x1b[B",
        "\x1bOC": "\x1b[C",
        "\x1bOD": "\x1b[D",
        "\x1bOH": "\x1b[H",
        "\x1bOF": "\x1b[F",
    }
    return mapped.get(key, key)


def _abbrev_path(path: Path) -> str:
    home = Path.home()
    try:
        return "~/" + path.resolve().relative_to(home).as_posix()
    except ValueError:
        return str(path)


def _git_branch(path: Path) -> str:
    try:
        return (
            subprocess.check_output(
                ["git", "rev-parse", "--abbrev-ref", "HEAD"],
                cwd=path,
                stderr=subprocess.DEVNULL,
                text=True,
            ).strip()
            or "HEAD"
        )
    except (subprocess.CalledProcessError, FileNotFoundError, OSError):
        return "HEAD"


if __name__ == "__main__":
    main()
