"""Build the home and session screens. See CONTEXT.md §11."""

from __future__ import annotations

from rich.align import Align
from rich import box
from rich.console import Console, ConsoleOptions, Group, RenderableType, RenderResult
from rich.layout import Layout
from rich.segment import Segment
from rich.style import Style
from rich.table import Table
from rich.text import Text

from harvey.cli import theme
from harvey.cli.state import TableData, ToolTrace, Turn, UiState


def box_width(term_width: int) -> int:
    return max(40, min(theme.BOX_WIDTH, term_width - 8))


def build_layout(state: UiState, width: int, height: int) -> Layout:
    layout = Layout()
    layout.split_column(
        Layout(name="body", ratio=1),
        Layout(name="footer", size=1),
    )
    layout["footer"].update(render_footer(state, width))
    if state.home:
        layout["body"].update(Align.center(render_home_cluster(state, width), vertical="middle"))
    else:
        layout["body"].update(SessionBody(state, width))
    return Screen(layout)


class Screen:
    """Paint the muted charcoal background behind the whole frame."""

    def __init__(self, renderable: RenderableType) -> None:
        self.renderable = renderable

    def __rich_console__(self, console: Console, options: ConsoleOptions) -> RenderResult:
        style = Style.parse(f"{theme.TEXT} on {theme.BG}")
        lines = console.render_lines(self.renderable, options, pad=True, style=style)
        newline = Segment.line()
        for line in lines:
            yield from line
            yield newline


class SessionBody:
    """Session transcript. Drops the wordmark before slicing mid-banner."""

    def __init__(self, state: UiState, width: int) -> None:
        self.state = state
        self.width = width

    def __rich_console__(self, console: Console, options: ConsoleOptions) -> RenderResult:
        height = options.height
        with_header = render_session_body(self.state, self.width, header=True)
        if height is None:
            yield with_header
            return
        lines = console.render_lines(with_header, options.update(height=None), pad=True)
        if len(lines) > height:
            without = render_session_body(self.state, self.width, header=False)
            lines = console.render_lines(without, options.update(height=None), pad=True)
            if len(lines) > height:
                lines = lines[-height:]
        newline = Segment.line()
        for line in lines:
            yield from line
            yield newline


def _column(width: int, *rows: RenderableType) -> Table:
    col = Table.grid(expand=False, padding=0)
    col.add_column(width=width)
    for row in rows:
        col.add_row(row)
    return col


def render_home_cluster(state: UiState, width: int) -> RenderableType:
    width_box = box_width(width)
    rows: list[RenderableType] = [
        render_input_box(state, width_box, committed=False),
        Text(),
        render_hints(width_box),
    ]
    if state.palette_open:
        rows.extend([Text(), render_palette(state, width_box)])
    return Group(
        render_wordmark(),
        Text(),
        Align.center(Text(theme.TAGLINE_TEXT, style=theme.TAGLINE)),
        Text(),
        Align.center(_column(width_box, *rows)),
    )


def render_session_body(state: UiState, width: int, *, header: bool = True) -> RenderableType:
    width_box = box_width(width)
    chunks: list[RenderableType] = []
    if header:
        chunks.extend(
            [
                render_wordmark(),
                Text(),
                Align.center(Text(theme.TAGLINE_TEXT, style=theme.TAGLINE)),
                Text(),
            ]
        )

    live_query = state.running or (state.active_turn and not state.active_turn.complete)
    completed = state.turns[:-1] if live_query else state.turns
    for turn in completed:
        chunks.append(
            Align.center(
                _column(
                    width_box,
                    render_input_box_for_query(turn.query, state, width_box),
                    Text(),
                    render_turn_trace(turn, width_box),
                    Text(),
                )
            )
        )

    if live_query and state.active_turn:
        live_rows: list[RenderableType] = [
            render_input_box(state, width_box, committed=True),
            Text(),
            render_turn_trace(state.active_turn, width_box),
            Text(),
            render_hints(width_box),
        ]
    else:
        live_rows = [
            render_input_box(state, width_box, committed=False),
            Text(),
            render_hints(width_box),
        ]
    if state.palette_open:
        live_rows.extend([Text(), render_palette(state, width_box)])
    chunks.append(Align.center(_column(width_box, *live_rows)))
    return Group(*chunks)


def render_wordmark() -> RenderableType:
    grid = Table.grid(expand=False, padding=0)
    grid.add_column(no_wrap=True)
    for line in theme.WORDMARK_LINES:
        grid.add_row(Text(line, style=f"bold {theme.HEADER}"))
    return Align.center(grid)


def render_input_box(state: UiState, width: int, *, committed: bool) -> Table:
    query = state.active_turn.query if committed and state.active_turn else state.input_text
    cursor = None if committed or state.running else state.cursor
    show_placeholder = not committed and not query
    return _chrome_box(
        _input_line(query, width, cursor=cursor, placeholder=show_placeholder),
        _status_line(state),
        width,
    )


def render_input_box_for_query(query: str, state: UiState, width: int) -> Table:
    return _chrome_box(_input_line(query, width, cursor=None, placeholder=False), _status_line(state), width)


def _chrome_box(line1: Text, line2: Text, width: int) -> Table:
    inner_w = max(8, width - 2)
    pad = Text(" " * inner_w, style=f"on {theme.INPUT_BG}")
    line1.truncate(inner_w)
    line2.truncate(inner_w)
    line1.pad_right(max(0, inner_w - line1.cell_len))
    line2.pad_right(max(0, inner_w - line2.cell_len))
    line1.stylize(f"on {theme.INPUT_BG}")
    line2.stylize(f"on {theme.INPUT_BG}")

    box = Table.grid(padding=0, expand=False)
    box.add_column(width=1)
    box.add_column(width=inner_w)
    bar = Text(" ", style=f"on {theme.ACCENT}")
    for row in (pad, line1, line2, pad):
        box.add_row(bar.copy(), row)
    return box


def _input_line(text: str, width: int, *, cursor: int | None, placeholder: bool) -> Text:
    inner_w = max(8, width - 4)
    if placeholder:
        ph = theme.PLACEHOLDER
        line = Text()
        if ph:
            line.append(ph[0], style=theme.CURSOR)
            line.append(ph[1:], style=theme.MUTED)
        line.truncate(inner_w, overflow="ellipsis")
        return line

    visible = text
    if cursor is None:
        line = Text(" " + visible, style=theme.TEXT)
        line.truncate(inner_w, overflow="ellipsis")
        return line

    cursor = max(0, min(cursor, len(visible)))
    before = visible[:cursor]
    after = visible[cursor:]
    caret_char = after[:1] if after else " "
    rest = after[1:]
    line = Text(" ", style=theme.TEXT)
    line.append(before, style=theme.TEXT)
    line.append(caret_char if after else "█", style=theme.CURSOR if after else theme.CURSOR)
    if after:
        line.append(rest, style=theme.TEXT)
    line.truncate(inner_w, overflow="ellipsis")
    return line


def _status_line(state: UiState) -> Text:
    line = Text()
    line.append(" Build", style=f"bold {theme.ACCENT}")
    line.append(f"  {state.research_mode}", style=theme.MUTED)
    line.append(f"  {state.model_label}", style=theme.TEXT)
    return line


def render_hints(width: int) -> Align:
    parts: list[str | tuple[str, str]] = []
    for i, (key, label) in enumerate(theme.HINTS):
        if i:
            parts.append("   ")
        parts.append((key, theme.MUTED))
        parts.append((f" {label}", theme.TEXT))
    hints = Text.assemble(*parts)
    return Align.right(hints, width=width)


def render_turn_trace(turn: Turn, width: int) -> RenderableType:
    blocks: list[RenderableType] = []
    if turn.tools:
        blocks.append(_render_tools(turn.tools, width))
    if turn.thought:
        blocks.append(Text(turn.thought, style=theme.TOOL))
    if turn.answer:
        answer = Text()
        answer.append("• ", style=theme.ANSWER_BULLET)
        answer.append(turn.answer, style=theme.ANSWER)
        blocks.append(answer)
    if turn.table:
        blocks.append(Text())
        blocks.append(_render_table(turn.table))
    if not blocks:
        if turn.complete:
            return Text("")
        return Text("  └ running…", style=theme.TOOL)
    return Group(*blocks)


def _render_tools(tools: list[ToolTrace], width: int) -> Text:
    out = Text()
    for tool in tools:
        args = _truncate_args(tool.args, max(12, width - len(tool.name) - 8))
        headline = f'{tool.name}("{args}")'
        if tool.error:
            out.append("• ", style=theme.ERROR)
            out.append(f"{headline} - FAILED\n", style=theme.ERROR)
            out.append(f"  └ Error: {tool.error}\n", style=theme.ERROR)
            continue
        out.append("• ", style=theme.TOOL)
        out.append(headline + "\n", style=theme.TOOL)
        details = list(tool.details)
        if tool.running and not details:
            details = ["running…"]
        elif tool.running and tool.duration_ms is None and details:
            pass
        for detail in details:
            out.append(f"  └ {detail}\n", style=theme.TOOL)
    return out


def _render_table(table: TableData) -> Table:
    styled = Table(
        show_header=True,
        header_style=f"bold {theme.TABLE}",
        border_style=theme.TABLE,
        box=box.SQUARE,
        expand=False,
        pad_edge=True,
    )
    for i, header in enumerate(table.headers):
        styled.add_column(header, justify="right" if i else "left", style=theme.TABLE)
    for row in table.rows:
        styled.add_row(*row)
    return styled


def render_palette(state: UiState, width: int) -> Table:
    table = Table.grid(padding=(0, 1), expand=False)
    table.add_column(width=min(width, 56))
    title = Text("commands", style=theme.ACCENT)
    table.add_row(title)
    for i, (cmd, blurb) in enumerate(theme.COMMANDS):
        style = f"bold {theme.BG} on {theme.ACCENT}" if i == state.palette_index else theme.MUTED
        table.add_row(Text(f"{cmd:<12} {blurb}", style=style))
    return table


def render_footer(state: UiState, width: int) -> Text:
    left = f"{state.cwd_label}:{state.git_branch}"
    right = theme.ENV_LABEL
    gap = max(1, width - len(left) - len(right))
    return Text(left + (" " * gap) + right, style=f"{theme.MUTED} on {theme.BG}")


def _truncate_args(args: str, limit: int) -> str:
    if len(args) <= limit:
        return args
    return args[: max(0, limit - 3)] + "..."
