# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Read-only fee probe for ListaDao.

Reads the fees CoinMarketCap records for the venue and the fee tier table of the Lista V3 Dex documentation.
Reads the enabled fee tiers on the live ListaV3Factory through a public BNB Smart Chain node, and the lending fee page.
Run from the repository root: uv run scripts/probes/venues/listadao/fees-probe.py
"""

import json
import re
import urllib.request
from datetime import datetime, timezone

UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) survey-probe"}
RPC = "https://bsc-rpc.publicnode.com"
FACTORY = "0xcb010ed373523942706F730b89792aA1C1597b20"  # ListaV3Factory, from for-developer/dex/smart-contract
FEE_AMOUNT_TICK_SPACING = "0x22afcccb"  # feeAmountTickSpacing(uint24)
TRIAL_FEES = [1, 2, 50, 100, 250, 500, 2500, 3000, 10000]  # the five documented tiers plus non tiers as controls
DOCS = "https://docs.bsc.lista.org"


def fetch(url: str, data: bytes | None = None, headers: dict | None = None) -> bytes:
    req = urllib.request.Request(url, data=data, headers={**UA, **(headers or {})})
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.read()


def cmc() -> None:
    d = json.loads(fetch("https://api.coinmarketcap.com/data-api/v3/exchange/detail?slug=listadao"))["data"]
    print(f"CoinMarketCap: makerFee {d['makerFee']} takerFee {d['takerFee']} fee urls {d['urls']['fee']}")


def docs_tiers() -> None:
    text = fetch(f"{DOCS}/for-developer/dex/mechanics.md").decode()
    rows = re.findall(r"^\|\s*([0-9.]+%)\s*\|\s*`(\d+)`\s*\|\s*`(\d+)`\s*\|\s*([^|]*)\|", text, re.M)
    print("Documented V3 fee tiers (tier, fee in ppm, tickSpacing, note):")
    for tier, fee, spacing, note in rows:
        print(f"  {tier} {fee} {spacing} {note.strip()}")


def factory_tiers() -> None:
    print(f"On chain ListaV3Factory {FACTORY} feeAmountTickSpacing:")
    for fee in TRIAL_FEES:
        data = FEE_AMOUNT_TICK_SPACING + fee.to_bytes(32, "big").hex()
        payload = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "eth_call", "params": [{"to": FACTORY, "data": data}, "latest"]}).encode()
        r = json.loads(fetch(RPC, payload, {"Content-Type": "application/json"}))
        res = r.get("result")
        spacing = int.from_bytes(bytes.fromhex(res[2:]), "big", signed=True) if res else None
        print(f"  fee {fee}: tickSpacing {spacing} ({'enabled' if spacing else 'not enabled'})")


def lending_fees() -> None:
    text = fetch(f"{DOCS}/introduction/lista-lending/fees.md").decode()
    for line in text.splitlines():
        if line.startswith("* "):
            print(f"Lending fees page: {line[2:]}")


def main() -> None:
    print(f"fees-probe start {datetime.now(timezone.utc).isoformat(timespec='seconds')}")
    cmc()
    docs_tiers()
    factory_tiers()
    lending_fees()
    print(f"fees-probe end {datetime.now(timezone.utc).isoformat(timespec='seconds')}")


if __name__ == "__main__":
    main()
