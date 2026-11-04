"""Read-only D76 benchmark on the canonical API and storefront, using the labeled local catalogue."""
from collections import defaultdict
from html import unescape
from pathlib import Path
from statistics import median
from time import perf_counter
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen
import json
import re

API = "http://127.0.0.1:5080"
STOREFRONT = "http://127.0.0.1:3000"
checks = []


def request(base, path, label, body=None, status=200, origin=None):
    payload = None if body is None else json.dumps(body).encode()
    headers = {"Content-Type": "application/json"} if payload is not None else {}
    if origin is not None:
        headers["Origin"] = origin
    start = perf_counter()
    try:
        result = urlopen(Request(base + path, payload, headers), timeout=15)
    except HTTPError as error:
        result = error
    with result:
        data = result.read().decode("utf-8")
        assert result.status == status, (label, result.status, data[:140])
        if path.startswith("/api/"):
            assert "no-store" in result.headers.get("Cache-Control", ""), label
        checks.append({
            "target": "api" if base == API else "storefront",
            "case": label, "status": result.status, "ms": round((perf_counter()-start)*1000, 1),
        })
        return data


def page(base, locale, label, body, status=200, origin=None):
    return json.loads(request(base, f"/api/catalog/{locale}/search", label, body, status, origin))


def slugs(response):
    return [product["slug"] for product in response["products"]]


exact = [
    ("sku", "D70-DEMO-A10-BLUE", "d70-sample-galaxy-a10"),
    ("arabic-letter", "گوشي سامسونگ", "galaxy-a56"),
    ("persian-digit", "سامسونگ A۱۰", "d70-sample-galaxy-a10"),
    ("half-space", "پلی‌استیشن ۵", "d70-sample-ps5-disc"),
    ("case-insensitive", "mAcBoOk", "d70-sample-macbook-air-m1"),
    ("usb-hyphen", "USB-C", "d70-sample-usb-c-charger"),
]
alternates = [
    ("iphone", "ای فون ۱۵", "iphone 15", "d70-sample-iphone-15"),
    ("galaxy", "گالکسی A56", "galaxy a56", "galaxy-a56"),
    ("latin-typo", "iphnoe 15", "iphone 15", "d70-sample-iphone-15"),
]
for locale in ("fa", "en"):
    for label, query, expected in exact:
        body = {"query": query}
        raw = page(API, locale, label, body)
        bff = page(STOREFRONT, locale, label, body, origin=STOREFRONT)
        assert slugs(bff) == slugs(raw) and expected in slugs(bff), (locale, label, slugs(bff))
        for key in ("total", "page", "pageSize", "totalPages", "matchingVariantIds"):
            assert bff[key] == raw[key], (locale, label, key)
        assert "suggestion" not in bff
        assert bff["locale"] == locale
        if label == "sku":
            p = bff["products"][0]
            assert any(v["sku"] == query and v["id"] == bff["matchingVariantIds"][p["id"]] for v in p["variants"])
    for label, query, candidate, expected in alternates:
        body = {"query": query, "pageSize": 4}
        raw = page(API, locale, label + "-exact-empty", body)
        bff = page(STOREFRONT, locale, label + "-suggestion", body)
        confirmed = page(API, locale, label + "-verified", {**body, "query": candidate, "pageSize": 1})
        assert raw["total"] == bff["total"] == 0
        assert bff["suggestion"] == {"query": candidate, "total": confirmed["total"]}
        assert expected in slugs(confirmed)
    filtered = page(STOREFRONT, locale, "filters-retained",
                    {"query": "ای فون ۱۵", "maxPriceRial": "1", "availableOnly": True})
    assert filtered["total"] == 0 and "suggestion" not in filtered
    unknown = page(STOREFRONT, locale, "unrecognized-spelling", {"query": "zzq-291-cat-no-product"})
    assert unknown["total"] == 0 and "suggestion" not in unknown
    stale = page(STOREFRONT, locale, "outside-range", {"query": "D70-DEMO", "page": 999})
    assert stale["total"] == 6 and stale["products"] == [] and "suggestion" not in stale
    first = page(STOREFRONT, locale, "page-one", {"query": "D70-DEMO", "pageSize": 2})
    second = page(STOREFRONT, locale, "page-two", {"query": "D70-DEMO", "pageSize": 2, "page": 2})
    assert first["total"] == second["total"] == 6 and not set(slugs(first)).intersection(slugs(second))
    html = unescape(request(STOREFRONT, f"/{locale}/catalog?" + urlencode({"q":"ای فون ۱۵"}), "SSR-suggestion"))
    assert 'catalog-search-suggestion' in html and 'iphone 15' in html
    assert re.search(r'<meta name="robots" content="[^"]*noindex', html)
    empty = unescape(request(STOREFRONT, f"/{locale}/catalog?q=D70-DEMO&page=999", "SSR-page-recovery"))
    assert ("بازگشت به صفحهٔ اول" if locale == "fa" else "Back to the first page") in empty
page(STOREFRONT, "fa", "nine-distinct-words", {"query": "one two three four five six seven eight nine"}, 400)
request(STOREFRONT, "/api/catalog/fa/search", "unrelated-origin", {"query":"iphone"}, 403, "https://unrelated.example")

groups = defaultdict(list)
for check in checks:
    if check["case"] in {case[0] for case in exact}:
        groups[check["target"] + "-exact"].append(check["ms"])
    elif check["case"].endswith("-suggestion"):
        groups["storefront-suggestion"].append(check["ms"])
report = {"passed": True, "readOnly": True, "checks": checks, "localMedianMs": {key: median(values) for key, values in groups.items()}}
path = Path("artifacts/checks/d76-catalog-discovery.json")
path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
print(json.dumps({"checks": len(checks), "medianMs": report["localMedianMs"], "report": str(path)}))
