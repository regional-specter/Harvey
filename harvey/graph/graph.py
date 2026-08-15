"""Compile the Harvey StateGraph. See CONTEXT.md §14."""

from __future__ import annotations

from langgraph.graph import END, START, StateGraph

from harvey.graph.nodes.commands import command_handler
from harvey.graph.nodes.extract_intent import extract_intent
from harvey.graph.nodes.generate import generate_answer
from harvey.graph.nodes.persist import persist_memory
from harvey.graph.nodes.retrieve import retrieve_memory
from harvey.graph.nodes.tools_router import route_tools, run_tools
from harvey.graph.state import HarveyState


def parse_command(state: HarveyState) -> dict:
    text = (state.get("user_input") or "").strip()
    if text.startswith("/"):
        return {"command": text.split()[0][1:]}
    return {"command": None}


def _after_parse(state: HarveyState) -> str:
    return "command_handler" if state.get("command") else "extract_intent"


def _after_route(state: HarveyState) -> str:
    return "run_tools" if state.get("tool_jobs") else "generate_answer"


def build_graph():
    graph = StateGraph(HarveyState)
    graph.add_node("parse_command", parse_command)
    graph.add_node("command_handler", command_handler)
    graph.add_node("extract_intent", extract_intent)
    graph.add_node("retrieve_memory", retrieve_memory)
    graph.add_node("route_tools", route_tools)
    graph.add_node("run_tools", run_tools)
    graph.add_node("generate_answer", generate_answer)
    graph.add_node("persist_memory", persist_memory)

    graph.add_edge(START, "parse_command")
    graph.add_conditional_edges(
        "parse_command",
        _after_parse,
        {"command_handler": "command_handler", "extract_intent": "extract_intent"},
    )
    graph.add_edge("command_handler", END)
    graph.add_edge("extract_intent", "retrieve_memory")
    graph.add_edge("retrieve_memory", "route_tools")
    graph.add_conditional_edges(
        "route_tools",
        _after_route,
        {"run_tools": "run_tools", "generate_answer": "generate_answer"},
    )
    graph.add_edge("run_tools", "generate_answer")
    graph.add_edge("generate_answer", "persist_memory")
    graph.add_edge("persist_memory", END)
    return graph.compile()


_graph = None


def get_graph():
    global _graph
    if _graph is None:
        _graph = build_graph()
    return _graph
