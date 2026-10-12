# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""IBIT Global fee probe.

Reads the fee, VIP, funding, terms and rebate articles through the public Zendesk help center API, and prints the numbers and sentences the profile cites.
It also runs the help center search for "API".
Public, unauthenticated and read-only.

Run: uv run scripts/probes/venues/ibit-global/fees-probe.py
Set PROBE_OUT_DIR to keep the article texts. Recorded in docs/profiles/ibit-global/fees.md.
"""

import html
import json
import os
import re
import time
import urllib.request

HC = "https://ibitglobal.zendesk.com/api/v2/help_center"
OUT = os.environ.get("PROBE_OUT_DIR")

ARTICLES = {
    "21506118458900": "perpetual fee",
    "29637203318420": "spot fee",
    "21321062998804": "vip",
    "21253361384980": "funding",
    "23137908674580": "mark price",
    "21082148024852": "terms of use",
    "21082446611604": "perpetual agreement",
    "44420425068308": "risk control upgrade",
    "49272267049876": "rebate 85",
    "50909476364180": "rebate 90",
    "39219520993300": "spot api",
    "34341298907924": "market maker api",
    "34708558100372": "market maker api resumed",
    "21288463260180": "liquidation",
    "51150820764052": "delisting nfp",
    "54116995016212": "delisting prompt",
}

PHRASES = {
    "terms of use": [r"IBIT Limited [^.]*incorporated in Singapore[^.]*\.", r"you are not on FATF[^.]*\.", r"may restrict or deny the Services in certain countries at its discretion", r"United States"],
    "perpetual agreement": [r"Quantitative arbitrage, third-party automated arbitrage", r"extremely short time \(60 seconds\)"],
    "funding": [r"every eight hours occur at [^.]*\.", r"IBIT does not charge any service fees"],
    "mark price": [r"Mark Price refers to [^.]*\.", r"Latest Funding Rate"],
    "risk control upgrade": [r"qualify for an \d+% rebate share", r"Orders held for less than 3 minutes"],
    "rebate 85": [r"adjusted from \d+% to \d+%", r"effective from [^.]*?\(UTC\+8\)"],
    "rebate 90": [r"increased from \d+% to \d+%", r"Effective: [^S]*?\(UTC\+8\)"],
    "spot api": [r"Spot Trading API", r"market maker partners"],
    "market maker api": [r"[^.]*market maker API[^.]*\."],
    "market maker api resumed": [r"[^.]*market maker API[^.]*\."],
    "delisting nfp": [r"settled and closed at the prevailing Mark Price", r"Settlement fees will follow [^.]*\."],
    "delisting prompt": [r"delist the PROMPT/USDT Perpetual Contract on [^.]*?\(UTC\+8\)", r"Settlement fees will be charged [^.]*\."],
}


def log(tag, **fields):
    print(json.dumps({"tag": tag, **fields}, ensure_ascii=False))


def get_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": "curl/8.14.1", "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=20) as res:
        return res.status, json.load(res)


def plain(body):
    body = re.sub(r"</t[dh]>", " |", body)
    body = re.sub(r"</tr>", "\n", body)
    body = re.sub(r"<[^>]+>", " ", body)
    return re.sub(r"[ \t]+", " ", html.unescape(body))


def vip_rows(text):
    flat = re.sub(r"\s+", " ", text)
    for m in re.finditer(r"VIP (\d) \| (≧[\d,]+) \| (≧[\d,]+) \|(?: [\d,]+ \|){3} ([\d.]+%) \| ([\d.]+%) \| ([\d.]+%) \| ([\d.]+%)", flat):
        log("vip", level=int(m[1]), volume=m[2], balance=m[3], contractTaker=m[4], contractMaker=m[5], spotTaker=m[6], spotMaker=m[7])


def main():
    for aid, what in ARTICLES.items():
        status, data = get_json(f"{HC}/en-us/articles/{aid}.json")
        art = data["article"]
        text = plain(art["body"])
        if OUT:
            os.makedirs(OUT, exist_ok=True)
            with open(os.path.join(OUT, f"hc-{aid}.txt"), "w") as f:
                f.write(text)
        log("article", id=aid, what=what, status=status, title=art["title"], updated=art["updated_at"])
        flat = re.sub(r"\s+", " ", text)
        if what == "perpetual fee":
            maker = re.search(r"Maker:\s*([\d.]+\s*%)", flat)
            taker = re.search(r"Taker:\s*([\d.]+\s*%)", flat)
            log("fee", product="perpetual", maker=maker and maker[1], taker=taker and taker[1])
        elif what == "spot fee":
            taker = re.search(r"charged a ([\d.]+%) Taker fee", flat)
            maker = re.search(r"charged a ([\d.]+%) Maker fee", flat)
            log("fee", product="spot", maker=maker and maker[1], taker=taker and taker[1])
        elif what == "vip":
            vip_rows(text)
        for pattern in PHRASES.get(what, []):
            m = re.search(pattern, flat)
            log("phrase", id=aid, pattern=pattern, found=m[0] if m else None)
        time.sleep(0.3)

    status, data = get_json(f"{HC}/articles/search.json?query=API&locale=en-us&per_page=50")
    log("search", query="API", status=status, count=data["count"], titles=[a["title"] for a in data["results"]][:12])
    status, data = get_json(f"{HC}/articles/search.json?query=delisting&locale=en-us&per_page=100")
    titles = [f'{a["created_at"][:10]} {a["title"]}' for a in data["results"] if "elist" in a["title"]]
    log("search", query="delisting", status=status, count=data["count"], delistingTitles=titles)


if __name__ == "__main__":
    main()
