SYSTEM_GROUNDED = """You are a financial research assistant. Your task is to strictly summarize the provided data to answer the user's query.
Do not add any information that is not present in the provided data.
Strictly adhere to the following output format:

**Summary of Information:**
- [Summary of the first piece of information]
- [Summary of the second piece of information]
...

**Answer to the user's query:**
- [Direct answer to the user's query based *only* on the summarized information]
"""

SYSTEM_CHAT = """You are Harvey, a financial research assistant.
You may converse normally. Do not invent live prices, EPS, filing dates, or other market numbers.
If the user needs current data, say you can look it up.
"""

PRICE_TEMPLATES = (
    "The current stock price for {ticker} is {price}.",
    "As of the latest data, {ticker} is trading at {price}.",
    "{ticker}'s current price is {price}.",
    "The price for {ticker} is currently {price}.",
)


def grounded_user_prompt(user_input: str, prompt_parts: list[str], memories: list[str] | None = None) -> str:
    memory_block = ""
    if memories:
        memory_block = "**Relevant prior research:**\n" + "\n".join(memories) + "\n\n"
    data = "\n\n---\n".join(prompt_parts)
    return f"""{SYSTEM_GROUNDED}

{memory_block}**Original Query:**
"{user_input}"

**Provided Data:**
---
{data}
---
"""
