# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Read-only probe of Bitcoiva's published fee text and the product facts its web bundle states.

Bitcoiva's fee table at /fee is loaded through the web app's own API, whose requests and replies are AES encrypted.
This probe reads only the static text the bundle ships, and CoinMarketCap's exchange record, and decrypts nothing.

Modes, all by default, or name some on the command line:
    bundle   the site HTML, main.js and the lazy chunks of four routes: /fee, /bitcoiva-apidocs, /futuretrade and /trade/:pair.
             It prints the fee FAQ sentences, the fee fields in the API doc examples, the rate limit table,
             the futures page's cTrader fields, and the stream URLs the trade page opens.
    cmc      CoinMarketCap's exchange detail for Bitcoiva: maker and taker fee fields, volume split, fee URL

Run from the repository root:
    uv run scripts/probes/venues/bitcoiva/fees-probe.py [mode ...]
"""

import json
import re
import sys
import time
import urllib.request
from pathlib import Path

SITE = "https://www.bitcoiva.com"
CMC = "https://api.coinmarketcap.com/data-api/v3/exchange/detail?slug=bitcoiva"
UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) survey-probe"}
WORK = Path(".claude/survey-work/bitcoiva")


def get(url: str) -> str:
    time.sleep(0.5)
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
        return r.read().decode(errors="replace")


def out(**kw) -> None:
    print(json.dumps(kw, ensure_ascii=False))


def lazy_chunks(main: str, component: str) -> tuple[list[str], str]:
    m = re.search(r"\b" + re.escape(component) + r"=r\.lazy\(\(\)=>(.{0,900}?)\.then\(n\.bind\(n,(\d+)\)\)", main)
    if not m:
        return [], ""
    return re.findall(r"n\.e\((\w+)\)", m.group(1)), m.group(2)


def route_component(main: str, path: str) -> str | None:
    m = re.search(r'path:"' + re.escape(path) + r'",element:\(0,p\.jsx\)\((\w+)', main)
    return m.group(1) if m else None


def fetch_route(main: str, cmap: dict, path: str, need: str) -> str:
    """Returns the text of the route's chunk that holds `need`, fetching the route's chunks one at a time."""
    comp = route_component(main, path)
    ids, module = lazy_chunks(main, comp) if comp else ([], "")
    out(mode="bundle", route=path, component=comp, chunks=len(ids), module=module)
    for cid in reversed(ids):
        cid = str(int(float(cid))) if "e" in cid else cid  # n.e(5e3) is chunk 5000
        h = cmap.get(cid)
        if not h:
            continue
        text = get(f"{SITE}/static/js/{cid}.{h}.chunk.js")
        if need in text:
            out(mode="bundle", route=path, chunk=f"{cid}.{h}.chunk.js", bytes=len(text))
            return text
    return ""


def around(text: str, needle: str, before: int = 0, after: int = 200) -> str | None:
    i = text.find(needle)
    return text[max(0, i - before): i + after] if i >= 0 else None


def mode_bundle() -> None:
    html = get(SITE + "/")
    main_name = re.search(r'src="(/static/js/main\.[0-9a-f]+\.js)"', html).group(1)
    main = get(SITE + main_name)
    out(mode="bundle", main=main_name, bytes=len(main))
    cmap = dict(re.findall(r'(\d+):"([0-9a-f]{8})"', re.search(r'"static/js/"\+e\+"\."\+(\{[^}]*\})', main).group(1)))

    helpers = sorted(set(re.findall(r'ApiHelper\("(ctrader/[A-Za-z]+)"', main)))
    out(mode="bundle", ctrader_calls=helpers)
    out(mode="bundle", menu_futures=around(main, '{"name":"Futures Trade"', 0, 120))

    fee = fetch_route(main, cmap, "/fee", "What are the exchange trading fees?")
    for q in ("What are the exchange trading fees?", "What is the trading fee for Instant Swap?", "What is the deposit fee on Bitcoiva?", "What is the Withdrawal fee on Bitcoiva?"):
        seg = around(fee, q, 0, 600) or ""
        ans = re.search(r'accordion-body",children:"([^"]+)"', seg)
        out(mode="bundle", page="/fee", question=q, answer=ans.group(1) if ans else None)
    out(mode="bundle", page="/fee", tabs=re.findall(r'children:\["([A-Za-z ]+Fee|Copy Trade)"', fee),
        futures_fee_units=[s for s in ("(Per Lot)", "(Per Trade Volume)") if s in fee],
        spot_columns=re.findall(r'\{id:"(makerfee|takerfee)",label:"([^"]+)"\}', fee))

    docs = fetch_route(main, cmap, "/bitcoiva-apidocs", "RATE LIMITS")
    out(mode="bundle", page="/bitcoiva-apidocs", base_urls=re.findall(r'API_BASE_URL:"([^"]+)"', docs))
    out(mode="bundle", page="/bitcoiva-apidocs", fee_fields_in_examples=sorted(set(re.findall(r"(makerFeePer:[.\d]+,takerFeePer:[.\d]+,tdsFeePer:[.\d]+)", docs))))
    out(mode="bundle", page="/bitcoiva-apidocs", rate_limits=re.findall(r'\{method:"(\w+)",endpoint:"([^"]+)",scope:"([^"]+)",limit:"([^"]+)",window:"([^"]+)"\}', docs))
    out(mode="bundle", page="/bitcoiva-apidocs", window_rule=(around(docs, "Limits use a fixed window", 0, 110) or "")[:110])
    out(mode="bundle", page="/bitcoiva-apidocs", depth_param=around(docs, "Number of depth levels", 0, 76),
        ticker_param=re.findall(r'endpoint:"/api/v1/ticker",desc:"[^"]*",params:\[\{name:"(\w+)"', docs),
        key_rights=around(docs, "Valid values: 'Create'", 0, 70),
        public_paths=sorted(set(re.findall(r'"(/api/v1/(?:ticker|depth))"', docs))),
        websocket_mentions=len(re.findall(r"wss://|WebSocket|websocket", docs)))

    fut = fetch_route(main, cmap, "/futuretrade", "ctraderTraderLogin")
    out(mode="bundle", page="/futuretrade", ctrader_fields=sorted(set(re.findall(r"\b(ctrader\w+|ctradeDatas|moneyDigits|usedMargin|PAMMStatus)\b", fut))),
        strings=[s for s in ("USDT to USD", "Demo Account ", "Live Account ", "+Open New Trading Account ") if s in fut])

    trade = fetch_route(main, cmap, "/trade/:pair", "stream.binance.com")
    out(mode="bundle", page="/trade/:pair", stream_urls=sorted(set(re.findall(r'"(wss://[^"]+)"', trade))),
        subscribe=around(trade, '"@depth20")],id:1}', 150, 20),
        url_choice=around(trade, '"wss://fstream.binance.com/stream"', 45, 160),
        socketio_hosts=sorted(set(re.findall(r'\(0,\w+\.io\)\("(https://[^"]+)"', trade))),
        room_event=around(trade, 'emit("bitcoiva_room"', 0, 50),
        liquidity_switch=around(trade, "0===d.liquidity?", 0, 230))


def mode_cmc() -> None:
    d = json.loads(get(CMC))["data"]
    out(mode="cmc", name=d.get("name"), launched=d.get("dateLaunched"), makerFee=d.get("makerFee"), takerFee=d.get("takerFee"),
        fee_url=d.get("urls", {}).get("fee"), tags=[t["slug"] for t in d.get("tags", [])],
        usd=d.get("quote", {}).get("2781"))


if __name__ == "__main__":
    WORK.mkdir(parents=True, exist_ok=True)
    modes = {"bundle": mode_bundle, "cmc": mode_cmc}
    for m in sys.argv[1:] or list(modes):
        modes[m]()
