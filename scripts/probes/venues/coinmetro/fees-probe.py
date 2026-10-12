# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Read-only fee and CCXT probe for Coinmetro.

It reads the public fee page and the Levels page, prints the exchange fee row of every Level,
then checks the installed CCXT 4.5.68 folder and the current CCXT source on GitHub for a coinmetro class.
It makes about eight requests in total.

Run from the repository root:
    uv run scripts/probes/venues/coinmetro/fees-probe.py
"""

import html
import json
import pathlib
import re
import time
import urllib.error
import urllib.request

UA = {"User-Agent": "arbitrage-observatory-probe/1.0"}
ROOT = pathlib.Path(__file__).resolve().parents[4]
CCXT_SRC = ROOT / "node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src"
DELIST = "9d406980c0cf23b1329183ee56189fd14d2f8a31"  # CCXT commit "fix(coinmetro)!: delist (#29069)"
LAST_WITH_CLASS = "aebca96c2a39599a2ccfc2a4dfe0b1a451c8e2a6"  # the previous commit that touched ts/src/coinmetro.ts


def fetch(url: str) -> tuple[int, str]:
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=20) as r:
            return r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")


def text(page: str) -> list[str]:
    page = re.sub(r"<script.*?</script>|<style.*?</style>", "", page, flags=re.S)
    return [ln.strip() for ln in html.unescape(re.sub(r"<[^>]+>", "\n", page)).split("\n") if ln.strip()]


def out(**kw) -> None:
    print(json.dumps(kw, ensure_ascii=False))


def main() -> None:
    print("# probe started", time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
    status, page = fetch("https://coinmetro.com/what-are-the-fees-on-coinmetro")
    lines = text(page)
    joined = " ".join(lines)
    out(page="fees", status=status, banner=next((ln for ln in lines if ln.startswith("Announcement")), None))
    for m in re.finditer(r"Level (\d)(?: \(Regular Fee\))?: Maker (-?[\d.]+)% \| Taker ([\d.]+)%", joined):
        lvl, mk, tk = m.groups()
        out(page="fees", level=int(lvl), maker_pct=mk, taker_pct=tk,
            maker_ppm=round(float(mk) * 10_000), taker_ppm=round(float(tk) * 10_000))
    for label in ("Entry fee:", "Exit fee:", "Daily interest (charged daily):", "Swap Markup:"):
        i = next((n for n, ln in enumerate(lines) if ln == label), None)
        out(page="fees", item=label, value=lines[i + 1] if i is not None else None)

    status, page = fetch("https://coinmetro.com/levels")
    flat = "|".join(text(page))
    rows = re.findall(r"\|0(\d)\|([^|]+)\|([\d.]+[KMB]?)\|.*?Taker Fee\|([\d.]+)%\|Maker Fee\|(-?[\d.]+)%", flat)
    for lvl, name, start, tk, mk in rows:
        out(page="levels", status=status, level=int(lvl), name=name, points_from=start, taker_pct=tk, maker_pct=mk)

    status, page = fetch("https://coinmetro.com/blog/announcement-onboarding-depositing-and-withdrawals")
    lines = text(page)
    out(page="announcement", status=status, date=next((ln for ln in lines if re.fullmatch(r"\w+ \d+, 20\d\d", ln)), None),
        statements=[ln for ln in lines if ln.startswith(("Due to", "We also disabled", "To ensure"))][:3])
    status, page = fetch("https://coinmetro.com/blog")
    lines = text(page)
    start = next((n for n, ln in enumerate(lines) if ln == "Industry News"), 0)
    out(page="blog", status=status, newest_titles=[ln for ln in lines[start + 1:start + 20] if len(ln) > 30 and not ln.endswith("\u2026")][:4])

    status, page = fetch("https://help.coinmetro.com/hc/en-gb/articles/6844007317789-What-are-the-fees-on-Coinmetro-")
    out(page="help center fee article, linked as fees by the last CCXT class", status=status, body=page[:40])

    local = sorted(p.name for p in CCXT_SRC.glob("*.js"))
    out(ccxt="installed 4.5.68", js_files=len(local), coinmetro_files=[n for n in local if "metro" in n],
        files_mentioning_coinmetro=[n for n in local if "coinmetro" in (CCXT_SRC / n).read_text(errors="replace").lower()])
    status, body = fetch("https://api.github.com/repos/ccxt/ccxt/commits?per_page=1&sha=master")
    head = json.loads(body)[0]
    status, body = fetch(f"https://api.github.com/repos/ccxt/ccxt/contents/ts/src?ref={head['sha']}")
    names = [x["name"] for x in json.loads(body) if x["type"] == "file" and x["name"].endswith(".ts")]
    out(ccxt="github master", sha=head["sha"], date=head["commit"]["committer"]["date"], ts_files=len(names),
        coinmetro=[n for n in names if "metro" in n])
    status, body = fetch(f"https://api.github.com/repos/ccxt/ccxt/commits/{DELIST}")
    c = json.loads(body)
    out(ccxt="delist commit", sha=DELIST, date=c["commit"]["committer"]["date"], message=c["commit"]["message"].split("\n")[0],
        removed=sum(1 for f in c["files"] if f["status"] == "removed"))
    status, src = fetch(f"https://raw.githubusercontent.com/ccxt/ccxt/{LAST_WITH_CLASS}/ts/src/coinmetro.ts")
    for n, ln in enumerate(src.split("\n"), 1):
        if re.search(r"'(taker|maker|swap|future|ws)':", ln) and n < 300:
            out(ccxt="last coinmetro.ts", sha=LAST_WITH_CLASS, line=n, text=ln.strip())


if __name__ == "__main__":
    main()
