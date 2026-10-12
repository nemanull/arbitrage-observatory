# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Read-only fee and rules probe for idax.

Fetches the help center pages on fees, funding, mark and index and the terms, prints their tables and key lines,
and counts the per contract fee fields of the futures open API catalog.
Run from the repository root: uv run scripts/probes/venues/idax/fees-probe.py
"""

import collections
import html
import json
import re
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

WORK = Path(".claude/survey-work/idax")
UA = "Mozilla/5.0 (X11; Linux x86_64) survey-probe"
PAGES = ["fee-structure", "funding-rate", "mark-price", "index-price", "futures-trading", "terms-and-conditions", "kyc-trade"]
CONTRACTS = "https://futuresopenapi.idax.exchange/fapi/v1/contracts"
CCXT_SRC = "node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src"
GITHUB_SRC = "https://api.github.com/repos/ccxt/ccxt/contents/ts/src"
TERMS_WORDS = re.compile(r"(?i)(restrict|prohibit|united states|sanction|jurisdiction|resident|eligib)")


def get(url: str) -> tuple[int, bytes]:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=30) as reply:
            return reply.status, reply.read()
    except urllib.error.HTTPError as error:
        return error.code, error.read()


def page_text(raw: str) -> str:
    raw = re.sub(r"<(script|style)[^>]*>.*?</\1>", "", raw, flags=re.S)
    start = raw.find("View Categories")
    raw = raw[start:] if start >= 0 else raw
    end = raw.find("Share This Article")
    raw = raw[:end] if end >= 0 else raw
    raw = re.sub(r"</(p|h\d|tr|li|div)>", "\n", raw)
    raw = re.sub(r"<t[dh][^>]*>", " | ", raw)
    text = html.unescape(re.sub(r"<[^>]+>", "", raw))
    text = re.sub(r"[ \t]+", " ", text)
    return re.sub(r"\n\s*\n+", "\n", text).strip()


def main() -> None:
    WORK.mkdir(parents=True, exist_ok=True)
    print("run at", datetime.now(timezone.utc).isoformat(timespec="seconds"))
    for slug in PAGES:
        url = f"https://support.idax.exchange/docs/{slug}/"
        status, body = get(url)
        text = page_text(body.decode("utf-8", "replace"))
        (WORK / f"doc-{slug}.txt").write_text(text)
        print(f"\n== {url} status {status}, {len(body)} bytes, {len(text)} chars of text")
        if slug == "terms-and-conditions":
            hits = [line for line in text.splitlines() if TERMS_WORDS.search(line)]
            print(f"{len(hits)} lines name a restriction, first 12:")
            for line in hits[:12]:
                print("  ", line[:300])
        else:
            print(text[:2500])

    status, body = get(CONTRACTS)
    rows = json.loads(body)
    live = [row for row in rows if row.get("status") == 1 and row.get("type") == "E"]
    print(f"\n== {CONTRACTS} status {status}, {len(rows)} rows, {len(live)} with type E and status 1")
    for field in ["openTakerFee", "closeTakerFee", "openMakerFee", "closeMakerFee"]:
        print(field, collections.Counter(row.get(field) for row in live).most_common())

    print("\n== CCXT")
    folder = Path(CCXT_SRC)
    names = sorted(path.name for path in folder.glob("*.js"))
    print(f"{CCXT_SRC}: {len(names)} .js files, names containing dax: {[n for n in names if 'dax' in n]}")
    hits = [n for n in names if "idax" in (folder / n).read_text(errors="replace").lower() and n not in ("indodax.js", "ndax.js")]
    print("other files containing 'idax':", hits)
    status, body = get(GITHUB_SRC)
    entries = [entry["name"] for entry in json.loads(body)] if status == 200 else []
    status_c, body_c = get("https://api.github.com/repos/ccxt/ccxt/commits?per_page=1")
    head = json.loads(body_c)[0] if status_c == 200 else {}
    print(f"GitHub ts/src: {status}, {len(entries)} entries, names containing dax: {[n for n in entries if 'dax' in n.lower()]}, head {head.get('sha')} {head.get('commit', {}).get('committer', {}).get('date')}")


if __name__ == "__main__":
    main()
