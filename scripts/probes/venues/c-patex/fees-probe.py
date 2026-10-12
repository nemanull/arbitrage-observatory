# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Read-only fee and product scope probe for C-Patex.

Public, unauthenticated, read-only, one request at a time.
Standard library only.

Modes, each printing one JSON line per finding:
    fees      the website's /v2/trade/settings and /v2/fee-schedule, the fee page's rendered text,
              the special fee token list in the web bundle, and the account-gated level endpoints.
    scope     whether C-Patex lists perpetuals or futures: the web app's route table, the marketlist tabs,
              the homepage roadmap line about futures, and CoinGecko's public derivatives exchange list.
    terms     the operator and the Prohibited Jurisdiction list in the terms embedded in the homepage.
    all       every mode above in turn.

Run from the repository root:
    uv run scripts/probes/venues/c-patex/fees-probe.py [fees|scope|terms|all]

Recorded in docs/profiles/c-patex/fees.md.
"""

import html
import json
import re
import sys
import time
import urllib.error
import urllib.request

SITE = "https://c-patex.com"
BACK = "https://back.c-patex.com"
UA = {"User-Agent": "Mozilla/5.0 (observatory-probe)"}


def log(tag: str, **fields) -> None:
    print(json.dumps({"tag": tag, "at": round(time.time(), 3), **fields}, default=str), flush=True)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def fetch(url: str, follow: bool = True) -> tuple[int, str, dict]:
    opener = urllib.request.build_opener() if follow else urllib.request.build_opener(NoRedirect)
    try:
        with opener.open(urllib.request.Request(url, headers=UA), timeout=30) as r:
            return r.status, r.read().decode("utf-8", "replace"), {k.lower(): v for k, v in r.headers.items()}
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace"), {k.lower(): v for k, v in e.headers.items()}


def chunks(page: str) -> dict[str, str]:
    out = {}
    for src in sorted(set(re.findall(r'/_nuxt/[0-9a-f]{7}\.js', page))):
        out[src] = fetch(SITE + src)[1]
        time.sleep(0.3)
    return out


def main_bundle(page: str) -> tuple[str, str]:
    """The largest Nuxt chunk linked from a page holds the route table, the i18n strings and the API client."""
    return max(chunks(page).items(), key=lambda kv: len(kv[1]))


def fees() -> None:
    status, body, _ = fetch(BACK + "/v2/trade/settings")
    log("trade_settings", status=status, body=json.loads(body) if body.startswith("{") else body[:200])
    status, body, _ = fetch(BACK + "/v2/fee-schedule")
    sched = json.loads(body)["response"]
    log("fee_schedule", status=status, bytes=len(body), currencies=len(sched), btc=sched.get("BTC"),
        keys_per_currency=sorted({k for v in sched.values() for k in v}),
        note="per currency deposit and withdrawal rows, no trading fee field")
    status, page, _ = fetch(SITE + "/fees")
    text = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", re.sub(r"<(script|style)[^>]*>.*?</\1>", "", page, flags=re.S)))
    i = text.find("Trading Fees")
    log("fees_page_text", status=status, excerpt=html.unescape(text[i - 40:i + 40]) if i >= 0 else None,
        note="server rendered before the client fetches /v2/trade/settings")
    for src, body in chunks(page).items():
        m = re.search(r'formattedFeeText:function\(\)\{return"".concat\(100\*this\.fee,"%"\)\}', body)
        k = re.search(r'fee:function\(t\)\{return t\.buySell\.fee\}', body)
        if m or k:
            log("fees_page_source", chunk=src, formatted_fee_is_100x_fee=bool(m), fee_comes_from_buySell_store=bool(k))
    status, landing, _ = fetch(SITE + "/")
    src, bundle = main_bundle(landing)
    v = re.search(r'v=\[("[A-Z]+"(?:,"[A-Z]+")*)\],x=2,w="auth_tokens"', bundle)
    w = re.search(r'function w\(e,t,r\)\{var n=t\.fee,o=t\.feePlc,c=t\.feePlcBuy;return f\.a\.includes\(e\)\?"sell"===r\?o:c:n\}', bundle)
    log("order_form_fee_rule", special_fee_tokens=v.group(1) if v else None, rule_found=bool(w),
        rule="stock in the special list uses fee_plc on sell and fee_plc_buy on buy, every other pair uses fee")
    for phrase in ("do not exceed 0.2%", "Fees start from 0.2%"):
        log("homepage_fee_phrase", phrase=phrase, present=phrase in landing)
    for path in ("/v2/ticket/levels", "/v2/ticket/info"):
        status, body, headers = fetch(BACK + path, follow=False)
        log("levels_endpoint", path=path, status=status, location=headers.get("location"))
        time.sleep(0.3)


def scope() -> None:
    status, landing, _ = fetch(SITE + "/")
    src, bundle = main_bundle(landing)
    paths = sorted(set(re.findall(r'path:"(/[^"]*)"', bundle)))
    english = sorted({p for p in paths if not re.match(r"^/[a-z]{2}(/|$)", p)})
    hits = [p for p in paths if re.search(r"futur|perp|swap|contract|deriv|margin|leverage", p, re.I)]
    log("routes", chunk=src, total=len(paths), unlocalized=english, derivative_like=hits)
    roadmap = re.findall(r'"[^"]*Futures[^"]*"', landing)
    log("homepage_futures_mentions", count=len(roadmap), mentions=roadmap[:5])
    status, body, _ = fetch(BACK + "/marketlist")
    tabs = [(t["label"], t["id"]) for t in json.loads(body)["response"]]
    log("marketlist_tabs", status=status, tabs=tabs)
    status, body, _ = fetch("https://api.coingecko.com/api/v3/derivatives/exchanges?per_page=250")
    rows = json.loads(body) if status == 200 else []
    match = [r for r in rows if "patex" in (r.get("id", "") + r.get("name", "")).lower()]
    log("coingecko_derivatives_exchanges", status=status, listed=len(rows), patex_rows=match)
    time.sleep(3)  # the keyless CoinGecko API refused a third call within a second with 429
    status, body, _ = fetch("https://api.coingecko.com/api/v3/exchanges/list")
    rows = json.loads(body) if status == 200 else []
    log("coingecko_exchanges_list", status=status, listed=len(rows),
        patex_rows=[r for r in rows if "patex" in (r.get("id", "") + r.get("name", "")).lower()])
    time.sleep(3)
    status, body, _ = fetch("https://api.coingecko.com/api/v3/exchanges/c_patex")
    log("coingecko_exchange_c_patex", status=status, body=body[:200])


def terms() -> None:
    status, landing, _ = fetch(SITE + "/")
    src, bundle = main_bundle(landing)
    text = html.unescape(bundle)
    op = re.search(r"DLT Swap Technologies Ltd, a company, established under the laws of [^.]*\.", text)
    log("operator", chunk=src, text=op.group(0) if op else None)
    text = html.unescape(landing)
    text = text.replace("\\u002F", "/").replace("\\u003C", "<").replace("\\u003E", ">")
    pj = re.search(r"Prohibited Jurisdiction(?:</q></strong>)? means any of the following jurisdictions and territories: ([^<]*?), and any", text)
    log("prohibited_jurisdictions", text=pj.group(1) if pj else None, canada_listed=bool(pj and "Canada" in pj.group(1)))


MODES = {"fees": fees, "scope": scope, "terms": terms}

if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "all"
    for name, fn in MODES.items():
        if mode in (name, "all"):
            log("mode", name=name)
            fn()
