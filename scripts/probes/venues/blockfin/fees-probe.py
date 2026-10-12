# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Read-only fee probe for BlockFin.

Public, unauthenticated, read-only.
Reads CoinMarketCap's maker and taker fields for BlockFin, asks the live fee and VIP pages up to four times each, 2 s apart,
because the restricted region rule refuses some requests and not others from this exit,
and reads the Internet Archive copies of those pages, retrying a 429 from the archive twice, 20 s apart.
From each page it gets it prints the title, every percent token, and the text around the words Maker and Taker.

Run from the repository root:
    uv run scripts/probes/venues/blockfin/fees-probe.py

Captures go to .claude/survey-work/blockfin/.
Recorded in docs/profiles/blockfin/fees.md.
"""

import collections
import html
import json
import re
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

WORK = Path(".claude/survey-work/blockfin")
UA = "Mozilla/5.0 (X11; Linux x86_64) survey-probe"
CMC = "https://api.coinmarketcap.com/data-api/v3/exchange/detail?slug=blockfin"
LIVE = ["https://blockfin.com/en/fees", "https://blockfin.com/en/vip"]
AVAILABLE = "https://archive.org/wayback/available?url={url}"
ARCHIVED = "https://web.archive.org/web/{ts}id_/{url}"
REFUSAL = re.compile(rb"IP address is from one of BlockFin's restricted")


def fetch(url: str):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=60) as reply:
            return reply.status, reply.read()
    except urllib.error.HTTPError as err:
        return err.code, err.read()


def plain(body: str) -> str:
    body = re.sub(r"<script.*?</script>|<style.*?</style>", " ", body, flags=re.S)
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", body)))


def archived(url: str) -> None:
    status, body = fetch(AVAILABLE.format(url=url.split("//", 1)[1]))
    closest = json.loads(body).get("archived_snapshots", {}).get("closest") if status == 200 else None
    print(json.dumps({"archive_lookup": url, "status": status, "closest": closest}))
    if not closest:
        return
    target = ARCHIVED.format(ts=closest["timestamp"], url=url)
    for attempt in range(3):
        status, body = fetch(target)
        print(json.dumps({"archived": target, "attempt": attempt + 1, "status": status, "bytes": len(body)}))
        if status != 429:
            break
        time.sleep(20)
    if status != 200:
        return
    name = url.rstrip("/").rsplit("/", 1)[-1]
    analyse(body, WORK / f"archived-{name}-{closest['timestamp']}.html")


def analyse(body: bytes, path: Path) -> None:
    text = body.decode("utf-8", "replace")
    path.write_text(text)
    title = re.search(r"<title>(.*?)</title>", text, re.S)
    words = plain(text)
    print(json.dumps({"title": title.group(1).strip() if title else None, "text_chars": len(words),
                      "percent_tokens": collections.Counter(re.findall(r"-?\d+(?:\.\d+)?\s?%", words)).most_common(20)}))
    shown = 0
    for m in re.finditer(r"(?i)\b(maker|taker)\b", words):
        print(json.dumps({"near": words[max(0, m.start() - 120):m.end() + 160]}))
        shown += 1
        if shown >= 12:
            break
    raw_rates = collections.Counter(re.findall(r'"(?:maker|taker)[A-Za-z]*"\s*:\s*"?[-0-9.]+', text))
    print(json.dumps({"raw_rate_fields": raw_rates.most_common(20)}))


def main() -> None:
    WORK.mkdir(parents=True, exist_ok=True)
    print(f"blockfin fee probe, {datetime.now(timezone.utc).isoformat(timespec='seconds')}")
    status, body = fetch(CMC)
    detail = json.loads(body)["data"]
    print(json.dumps({"cmc_makerFee_percent": detail["makerFee"], "cmc_takerFee_percent": detail["takerFee"], "cmc_fee_url": detail["urls"]["fee"]}))
    for url in LIVE:
        for attempt in range(4):
            status, body = fetch(url)
            refused = bool(REFUSAL.search(body))
            print(json.dumps({"live": url, "attempt": attempt + 1, "status": status, "bytes": len(body), "restricted_page": refused}))
            if status == 200 and not refused:
                analyse(body, WORK / f"live-{url.rsplit('/', 1)[-1]}.html")
                break
            time.sleep(2)
    for url in LIVE:
        archived(url)


if __name__ == "__main__":
    main()
