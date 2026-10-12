# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""YoBit web app socket bundle probe, read-only.

YoBit documents no WebSocket API, but its trade page loads https://yobit.net/js/autobahn.min.js and https://yobit.net/js/corews.js.
corews.js is obfuscated, and its strings sit in one array, each encoded as base64 and then RC4 with a short per-call key.
This probe downloads the file as text, never runs it, decodes every array string with every key that appears in the file, and prints the ones that name the socket.
It also reads the pair_id and the signed-out fee variables of one trade page.

Run from the repository root: uv run scripts/probes/venues/yobit/bundle-probe.py
"""

import re
import time
import urllib.parse
import urllib.request

UA = "Mozilla/5.0 (X11; Linux x86_64) arbitrage-observatory venue survey probe"
ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+/="
WANTED = {"url", "realm", "restricted_realm", "subscribe", "Connection", "ticker", "tickerst", "ordlst", "trhist", "deticker", "dehist", "hb", "onopen", "onclose"}


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode("utf-8", "replace")


def b64(s):
    out, q, bs = [], 0, 0
    for ch in s:
        idx = ALPHABET.find(ch)
        if idx < 0 or idx == 64:
            continue
        bs = bs * 64 + idx if q % 4 else idx
        if q % 4:
            out.append(chr(255 & (bs >> (-2 * (q + 1) & 6))))
        q += 1
    return "".join(out)


def rc4(s, key):
    d = b64(s)
    try:
        d = urllib.parse.unquote("".join("%" + format(ord(c), "02x") for c in d), errors="strict")
    except UnicodeDecodeError:
        return None
    S = list(range(256))
    j = 0
    for i in range(256):
        j = (j + S[i] + ord(key[i % len(key)])) % 256
        S[i], S[j] = S[j], S[i]
    i = j = 0
    out = []
    for c in d:
        i = (i + 1) % 256
        j = (j + S[i]) % 256
        S[i], S[j] = S[j], S[i]
        out.append(chr(ord(c) ^ S[(S[i] + S[j]) % 256]))
    return "".join(out)


def main():
    print("YoBit bundle probe at", time.strftime("%Y-%m-%d %H:%M:%S UTC", time.gmtime()))
    page = get("https://yobit.net/en/trade/BTC/USDT")
    scripts = re.findall(r'src="(/js/(?:autobahn|corews)[^"]*)"', page)
    print("trade page loads", scripts)
    for name in ("pair_id", "currency_name1", "currency_name2", "fee_buyer", "fee_seller"):
        m = re.search(rf"var {name} = '?([^';]*)'?;", page)
        print(name, m.group(1) if m else None)
    src = get("https://yobit.net" + next(s for s in scripts if "corews" in s))
    print("corews.js length", len(src))
    m = re.search(r"function (a0_0x[0-9a-f]+)\(\)\{var _0x[0-9a-f]+=\[(.*?)\];", src, re.S)
    arr = [s.encode().decode("unicode_escape") for s in re.findall(r"'((?:[^'\\]|\\.)*)'", m.group(2))]
    keys = set(re.findall(r"'([^'\\]{4})'", src))
    print("string array size", len(arr), "candidate keys", len(keys))
    found = set()
    for s in arr:
        for k in keys:
            r = rc4(s, k)
            if r and (r in WANTED or r.startswith("wss://") or r.startswith("ws://")):
                found.add(r)
    print("decoded socket strings", sorted(found))
    for fn in ("initWebSockets", "tickerOrdLst", "tickerTradeHistory", "tickerEvent", "heartbeatEvent", "checkConnection"):
        print("function", fn, "present", f"function {fn}(" in src)
    m = re.search(r"function checkConnection\(\)\{([^}]*)\}function resetWebSocket\(\)\{([^}]*)\}", src)
    print("checkConnection body", m.group(1) if m else None, "resetWebSocket body", repr(m.group(2)) if m else None)
    print("topics built from pair_id", len(re.findall(r"\+pair_id,", src)), "literal hb topic", "('hb',heartbeatEvent)" in src)


if __name__ == "__main__":
    main()
