# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Ripio Trade fee sources probe, read-only and unauthenticated.

The Argentine Ripio Trade terms at https://terms.ripio.com/ar/ripio-trade hold the maker and taker schedule as a screenshot, not as text.
This probe finds that image, downloads it into the gitignored work folder when it exists, and prints its size and SHA-256 so the table read from it can be tied to one file.
It also records the status of the Brazilian fee page the trade app links, its Wayback availability, and the private fee call without credentials.

Run from the repository root: uv run scripts/probes/venues/ripio/fees-probe.py
"""

import hashlib
import html
import json
import pathlib
import re
import time
import urllib.error
import urllib.request

UA = "Mozilla/5.0 (X11; Linux x86_64) arbitrage-observatory venue survey probe"
TERMS_AR = "https://terms.ripio.com/ar/ripio-trade"
FEES_BR = "https://www.ripio.com/br/limites-e-taxas-operacionais-exchange/"
WORK = pathlib.Path(__file__).resolve().parents[4] / ".claude" / "survey-work" / "ripio"


def get(url, accept="*/*"):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": accept})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, r.geturl(), r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.geturl(), e.read()


def text_of(page):
    page = re.sub(r"<script.*?</script>|<style.*?</style>", "", page, flags=re.S)
    return [ln.strip() for ln in html.unescape(re.sub(r"<[^>]+>", "\n", page)).split("\n") if ln.strip()]


def main():
    print(f"Ripio fees probe, started {time.strftime('%Y-%m-%d %H:%M:%S', time.gmtime())} UTC")

    status, final, body = get(TERMS_AR)
    page = body.decode("utf-8", "replace")
    lines = text_of(page)
    print(f"\nGET {TERMS_AR}: {status}, {len(body)} bytes")
    for i, ln in enumerate(lines):
        if ln.startswith("Última actualización"):
            print(f"  update line: {ln} {lines[i + 1]}")
        if "Moonbird SRL CUIT" in ln:
            print(f"  entity line: {ln[ln.index('Moonbird SRL CUIT'):][:140]}")
    m = re.search(r"siguiente cuadro:.*?<img[^>]*src=\"([^\"]+)\"", page, flags=re.S)
    after = page[page.find("siguiente cuadro"):][:2500]
    print("  sentence before the table:", "Dependiendo el volumen de operaciones, la comisión será determinada según el siguiente cuadro:" in html.unescape(re.sub(r"<[^>]+>", "", page)))
    print("  table cells in the HTML after that sentence:", after.count("<td"))
    tier_line = next((ln for ln in lines if ln.startswith("El nivel se define")), None)
    print(f"  tier rule: {tier_line}")
    if m:
        url = m.group(1)
        st, _, img = get(url)
        print(f"  fee table image: {url}")
        print(f"  image GET {st}, {len(img)} bytes, sha256 {hashlib.sha256(img).hexdigest()}, PNG {img[:8] == bytes.fromhex('89504e470d0a1a0a')}")
        if img[:8] == bytes.fromhex("89504e470d0a1a0a"):
            w, h = int.from_bytes(img[16:20], "big"), int.from_bytes(img[20:24], "big")
            print(f"  image size {w} x {h}")
        if WORK.is_dir():
            (WORK / "fee_table.png").write_bytes(img)
            print(f"  saved to {WORK / 'fee_table.png'}")
    else:
        print("  no image found after the table sentence")

    for url in (FEES_BR, "https://www.ripio.com/pt/produtos/ripio-trade/taxas", "https://terms.ripio.com/br/ripio-trade"):
        status, final, body = get(url)
        print(f"\nGET {url}: {status}, final URL {final}, {len(body)} bytes")
        time.sleep(1)

    for url in ("www.ripio.com/pt/produtos/ripio-trade/taxas", "www.ripio.com/br/limites-e-taxas-operacionais-exchange/"):
        status, _, body = get(f"https://archive.org/wayback/available?url={url}")
        try:
            snap = json.loads(body)["archived_snapshots"].get("closest")
        except ValueError:
            snap = body[:120]
        print(f"\nWayback availability for {url}: {status} {snap}")
        if isinstance(snap, dict):
            raw = snap["url"].replace("/web/" + snap["timestamp"] + "/", "/web/" + snap["timestamp"] + "id_/")
            st, _, page = get(raw)
            print(f"  snapshot GET {st}, {len(page)} bytes, starts {page[:80]!r}")
            if st == 200:
                for ln in text_of(page.decode("utf-8", "replace")):
                    if "%" in ln and len(ln) < 160:
                        print(f"    {ln}")
        time.sleep(2)

    status, _, body = get("https://api.ripiotrade.co/v4/user/trading-fees?pair=BTC_USDC", accept="application/json")
    print(f"\nGET /v4/user/trading-fees?pair=BTC_USDC without credentials: {status} {body[:200].decode('utf-8', 'replace')}")


main()
