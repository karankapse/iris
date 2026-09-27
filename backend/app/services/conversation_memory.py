"""Conversation-mood memory: find past moments that resemble what the partner just said, and
tell Claude how this person actually felt and replied then.

Matching is plain keyword overlap (no extra service or API key): cheap, private, and good enough
to connect "Are you in pain?" with "Does your back hurt today?". Swap `similarity` for embeddings
later if needed.
"""

import re
from collections import Counter

# Words that say nothing about the topic.
STOPWORDS = set(
    """a an the and or but if then so to of in on at for with from by about as is are was were be
    been being am do does did have has had i you he she it we they me him her us them my your his
    its our their this that these those what which who whom how when where why can could would
    should will shall may might must not no yes just now today really very too also there here
    want wants some any all please ok okay oh hey hi hello well""".split()
)

MAX_MATCHES = 4
MIN_SCORE = 0.2


def keywords(text: str) -> set[str]:
    """Lower-case content words, with a crude stem so 'hurts' matches 'hurt'."""
    words = re.findall(r"[a-z']+", text.lower())
    out = set()
    for w in words:
        w = w.strip("'")
        if len(w) < 3 or w in STOPWORDS:
            continue
        for suffix in ("ing", "ed", "es", "s"):
            if w.endswith(suffix) and len(w) - len(suffix) >= 3:
                w = w[: -len(suffix)]
                break
        out.add(w)
    return out


def similarity(a: set[str], b: set[str]) -> float:
    """Share of keywords in common (Jaccard). 0 = nothing shared, 1 = the same keywords."""
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


def similar_moments(past: list[dict], partner_text: str) -> list[dict]:
    """The past exchanges most like `partner_text`, best first (recent ones win ties)."""
    query = keywords(partner_text)
    scored = []
    for i, row in enumerate(past):  # `past` is newest first
        score = similarity(query, keywords(row["partner_text"]))
        if score >= MIN_SCORE:
            scored.append((score, -i, row))
    scored.sort(key=lambda s: (s[0], s[1]), reverse=True)
    return [row for _, _, row in scored[:MAX_MATCHES]]


def felt(row: dict) -> str | None:
    """How the person felt in that moment: the detected emotion, else the tone they chose."""
    return row.get("detected_emotion") or row.get("reply_tone")


def memory_prompt(matches: list[dict]) -> str:
    """A short block for the prompt, or '' when there is nothing relevant."""
    if not matches:
        return ""
    lines = []
    for m in matches:
        verdict = {1: "tone felt right", 0: "tone felt WRONG"}.get(m.get("tone_ok"), "")
        how = felt(m)
        lines.append(
            f'- Partner: "{m["partner_text"]}" -> I felt {how or "unknown"}'
            f' -> I said: "{m["reply_text"]}" ({m["reply_tone"]}'
            + (f"; {verdict}" if verdict else "")
            + ")"
        )
    feelings = Counter(f for f in (felt(m) for m in matches) if f)
    usual = ""
    if feelings:
        emotion, n = feelings.most_common(1)[0]
        usual = f"\nIn these similar moments I most often felt {emotion} ({n} of {len(matches)})."
    return (
        "Similar moments from my past conversations (what was said -> how I felt -> my reply):\n"
        + "\n".join(lines)
        + usual
        + "\nLean toward how I actually tend to feel and talk about this, unless my current"
        " reaction clearly says otherwise. Avoid tones I marked as wrong.\n\n"
    )
