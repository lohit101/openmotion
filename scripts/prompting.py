"""Shared, descriptive SCAIL prompts; no vision API or extra model is loaded."""

import json
from pathlib import Path

PROMPTS = json.loads((Path(__file__).resolve().parents[1] / "config/prompts.json").read_text())


def compile_prompt(prompt="", mode="swap"):
    if mode not in ("swap", "motion"):
        raise ValueError("Choose swap or motion mode.")
    custom = prompt.strip()
    compact = lambda value: " ".join(value.split())
    defaults = [PROMPTS["swap"], PROMPTS["motion"]] + PROMPTS["legacyDemoPrompts"]
    if not custom or compact(custom) in [compact(value) for value in defaults]:
        return PROMPTS[mode]
    return PROMPTS[mode] + "\n\n" + custom
