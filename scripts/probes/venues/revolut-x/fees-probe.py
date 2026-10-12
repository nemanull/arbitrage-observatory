# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Read-only probe of the published Revolut X fee sources, as reachable from this host.

Sections, all by default, or name some on the command line:
    pages   the fee, trading rules and product pages on revolut.com and exchange.revolut.com,
            recording status, title and the cf-mitigated header, since Cloudflare challenges them from this host.
    repo    the official revolut-engineering/revolut-x-api repository: the fee article its MCP server ships,
            the SDK's fee constants, and the entity article.
    ccxt    whether CCXT 4.5.68 under node_modules has a Revolut class, and the fee lines of CCXT master's revolutx class.

Run from the repository root:
    uv run scripts/probes/venues/revolut-x/fees-probe.py [section ...]
"""

import json
import pathlib
import re
import sys
import time
import urllib.error
import urllib.request

PAGES = [
    "https://www.revolut.com/legal/crypto-exchange-fees/",
    "https://www.revolut.com/legal/crypto-exchange-trading-rules/",
    "https://www.revolut.com/revolut-x/",
    "https://exchange.revolut.com/fees",
    "https://exchange.revolut.com/",
]
REPO_RAW = "https://raw.githubusercontent.com/revolut-engineering/revolut-x-api/master/"
REPO_FILES = ["mcp/src/data/articles/revolut-x-fees.md", "api/src/config/fees.ts", "mcp/src/data/articles/revolut-x-crypto-services-provider.md"]
CCXT_DIR = pathlib.Path(__file__).resolve().parents[4] / "node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src"
CCXT_MASTER = "https://raw.githubusercontent.com/ccxt/ccxt/master/ts/src/revolutx.ts"


def out(section: str, **kw) -> None:
    print(json.dumps({"section": section, **kw}, ensure_ascii=False, default=str), flush=True)


def fetch(url: str) -> tuple[int, dict, str]:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) arbitrage-observatory-probe/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, dict(r.headers), r.read().decode(errors="replace")
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read().decode(errors="replace")


def section_pages() -> None:
    for url in PAGES:
        status, headers, text = fetch(url)
        title = re.search(r"<title>(.*?)</title>", text, re.S)
        out("pages", url=url, status=status, title=title.group(1).strip() if title else None,
            cf_mitigated=headers.get("cf-mitigated"), server=headers.get("server") or headers.get("Server"))
        time.sleep(1)


def section_repo() -> None:
    for path in REPO_FILES:
        status, _, text = fetch(REPO_RAW + path)
        keep = [ln for ln in text.splitlines() if re.search(r"fee|maker|taker|%|Revolut Ltd|FRN", ln, re.I)]
        out("repo", path=path, status=status, lines=keep[:12])


def section_ccxt() -> None:
    files = sorted(p.name for p in CCXT_DIR.glob("*.js"))
    named = [f for f in files if "revol" in f.lower()]
    texty = [f for f in files if "revolut" in (CCXT_DIR / f).read_text(errors="ignore").lower()]
    out("ccxt", dir=str(CCXT_DIR), js_files=len(files), files_named_revolut=named, files_mentioning_revolut=texty)
    status, _, text = fetch(CCXT_MASTER)
    lines = [(i + 1, ln.strip()) for i, ln in enumerate(text.splitlines()) if re.search(r"'(taker|maker|tierBased|swap|spot)'", ln)]
    out("ccxt", url=CCXT_MASTER, status=status, fee_and_type_lines=lines)


if __name__ == "__main__":
    names = sys.argv[1:] or ["pages", "repo", "ccxt"]
    out("start", utc=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), sections=names)
    for n in names:
        {"pages": section_pages, "repo": section_repo, "ccxt": section_ccxt}[n]()
