"""Color tokens for the Rich TUI. Muted charcoal + mint, Oxide-inspired."""

# Surfaces
BG = "#121b1e"
INPUT_BG = "#1a2428"

# Type
HEADER = "#4ecb90"
TAGLINE = "#94a3a8"
MUTED = "#94a3a8"
TEXT = "#d1d5db"
ACCENT = "#4ecb90"

# Traces
TOOL = "#4ecb90"
ANSWER_BULLET = "#4ecb90"
ANSWER = "#d1d5db"
ERROR = "#c45c4a"
TABLE = "#4ecb90"
CURSOR = f"reverse {TEXT}"

PLACEHOLDER = 'Ask anything... "What\'s AAPL trading at?"'
TAGLINE_TEXT = "Your AI assistant for deep financial research."
MODEL_LABEL = "Google: Gemini Flash"
STATUS_VERB = "Build"
ENV_LABEL = "local"

BOX_WIDTH = 72
HINTS = (("tab", "agents"), ("ctrl+p", "commands"), ("ctrl+q", "quit"))

RESEARCH_MODES = ("long-term", "short-term", "risk", "macro")

COMMANDS = (
    ("/summary", "Summarize the current research thread"),
    ("/export", "Write memories to a JSON file"),
    ("/clear-mem", "Clear intent-tagged memory"),
    ("/help", "Show available commands"),
    ("/quit", "Exit Harvey"),
)

WORDMARK_LINES = [
    "██╗  ██╗ █████╗ ██████╗ ██╗   ██╗███████╗██╗   ██╗",
    "██║  ██║██╔══██╗██╔══██╗╚██╗ ██╔╝██╔════╝╚██╗ ██╔╝",
    "███████║███████║██████╔╝ ╚████╔╝ █████╗   ╚████╔╝ ",
    "██╔══██║██╔══██╗██╔══██╗  ╚██╔╝  ██╔══╝    ╚██╔╝  ",
    "██║  ██║██║  ██║██║  ██║   ██║   ███████╗   ██║   ",
    "╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝   ╚═╝   ╚══════╝   ╚═╝   ",
]
WORDMARK = "\n".join(WORDMARK_LINES)
