# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""IBIT Global REST probe.

Records what the web host, the unsigned /v1 paths its web app calls, and CoinMarketCap's market pair listing return to this host.
Public, unauthenticated and read-only.
The web app signs every /v1 request in the browser, and this probe never computes that signature.
It also reads the web app's JavaScript chunks and lists the socket hosts and /v1 paths they name.

Run: uv run scripts/probes/venues/ibit-global/rest-probe.py
Set PROBE_OUT_DIR to keep raw bodies. Recorded in docs/profiles/ibit-global/rest.md.
"""

import collections
import json
import os
import re
import socket
import time
import urllib.error
import urllib.request

WEB = "https://www.ibitglobal.ai"
CMC = "https://api.coinmarketcap.com/data-api/v3/exchange/market-pairs/latest?slug=ibit-global&category={}&start=1&limit=200"
CURL_UA = "curl/8.14.1"
BROWSER_UA = "Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0"
OUT = os.environ.get("PROBE_OUT_DIR")


def log(tag, **fields):
    print(json.dumps({"tag": tag, **fields}, ensure_ascii=False))


def keep(name, body):
    if not OUT:
        return
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, name), "wb") as f:
        f.write(body)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


OPENER = urllib.request.build_opener(NoRedirect)


def hit(url, name, ua=CURL_UA, quiet=False):
    t0 = time.perf_counter()
    req = urllib.request.Request(url, headers={"User-Agent": ua, "Accept": "*/*"})
    try:
        res = OPENER.open(req, timeout=20)
        status, headers, body = res.status, res.headers, res.read()
    except urllib.error.HTTPError as e:
        status, headers, body = e.code, e.headers, e.read()
    ms = round((time.perf_counter() - t0) * 1000)
    keep(name, body)
    text = body.decode("utf-8", "replace")
    title = re.search(r"<TITLE>([^<]*)</TITLE>", text, re.I)
    ref = re.search(r"Reference&#32;&#35;([^<\s]*)", text)
    if not quiet:
        log(
            "http",
            url=url,
            ua="browser" if ua == BROWSER_UA else "curl",
            status=status,
            ms=ms,
            bytes=len(body),
            type=headers.get("content-type"),
            location=headers.get("location"),
            title=title.group(1) if title else None,
            akamaiRef=ref.group(1).replace("&#46;", ".") if ref else None,
            retryAfter=headers.get("retry-after"),
        )
    return status, text


def resolve():
    hosts = ["www.ibitglobal.ai", "ibit.global", "prod-ibit-market-server-p-co-p-group.aka-line-a.com"]
    guesses = ["api.ibitglobal.ai", "openapi.ibitglobal.ai", "api.ibit.global", "openapi.ibit.global", "docs.ibit.global"]
    for host in hosts + guesses:
        try:
            cname, _, addrs = socket.gethostbyname_ex(host)
            log("dns", host=host, canonical=cname, addresses=sorted(addrs))
        except OSError as e:
            log("dns", host=host, error=str(e))


def web_host():
    hit(f"{WEB}/", "root-cold.html")
    hit(f"{WEB}/", "root-warm.html")
    hit("https://ibit.global/", "ibit-global-root.html")
    hit(f"{WEB}/zh-CN", "zh-CN-browser-ua.html", ua=BROWSER_UA)
    status, page = hit(f"{WEB}/zh-CN", "zh-CN.html")
    return page if status == 200 else ""


def bundle(page):
    chunks = sorted(set(re.findall(r'/_next/static/[^"]*?\.js', page)))
    sockets, paths = set(), set()
    signed = 0
    for path in chunks:
        _, js = hit(f"{WEB}{path}", "chunk-" + path.rsplit("/", 1)[-1], quiet=True)
        sockets.update(re.findall(r"wss://[A-Za-z0-9._/-]+", js))
        paths.update(re.findall(r'"(/v1/[A-Za-z/]+)"', js))
        signed += js.count('e.headers["ibit-sign"]')
        time.sleep(0.2)
    log("bundle", chunks=len(chunks), sockets=sorted(sockets), v1Paths=len(paths), requestSignerSites=signed)


def api_key_page():
    # The account page that creates API keys. Its translations and its chunk name the permissions a key can hold.
    status, page = hit(f"{WEB}/en-US/member/apiManagement", "api-management.html")
    labels = dict(re.findall(r'apiManagement_page_form_authority_([A-Z]+)\\?":\\?"([^"\\]+)', page))
    known = set(re.findall(r'/_next/static/[^"]*?\.js', page))
    enums, doc_link = set(), None
    for path in sorted(known):
        _, js = hit(f"{WEB}{path}", "api-chunk-" + path.rsplit("/", 1)[-1], quiet=True)
        if "apiManagement_page_table_authority_" in js:
            enums.update(re.findall(r'\["([A-Z]+)",t\("apiManagement_page_table_authority_', js))
            m = re.search(r'"div",\{className:"api_description_document"(\}|,children:[^}]*\})', js)
            doc_link = m.group(0) if m else None
        time.sleep(0.2)
    log("apiKeyPage", status=status, permissionLabels=labels, permissionEnum=sorted(enums), docsElement=doc_link)


def unsigned_paths():
    for p in [
        "/v1/futures/symbolList",
        "/v1/futures/contractConfig",
        "/v1/futures/positionFeeRate",
        "/v1/coMarket/marketSnapshot",
        "/v1/spot/common/coinList",
    ]:
        hit(f"{WEB}{p}", p.strip("/").replace("/", "_") + ".html")
        time.sleep(0.3)


def coinmarketcap():
    for category in ["perpetual", "spot", "futures"]:
        status, text = hit(CMC.format(category), f"cmc-{category}.json", quiet=True)
        data = json.loads(text).get("data", {})
        pairs = data.get("marketPairs", [])
        funding = collections.Counter(p.get("fundingRate") for p in pairs)
        quotes = collections.Counter(p.get("quoteSymbol") for p in pairs)
        first = pairs[0] if pairs else {}
        log(
            "cmc",
            category=category,
            status=status,
            numMarketPairs=data.get("numMarketPairs"),
            listed=len(pairs),
            quotes=dict(quotes),
            fundingRates={str(k): v for k, v in funding.most_common()},
            sampleUrl=first.get("marketUrl"),
            sampleUpdated=first.get("lastUpdated"),
        )


if __name__ == "__main__":
    resolve()
    page = web_host()
    if page:
        bundle(page)
    api_key_page()
    unsigned_paths()
    coinmarketcap()
