"""Bulk find/replace + page rename for Gold Coast Pool Builders.

CONSERVATIVE — only boilerplate (URLs, brand, suburb names, postcode/coords, file renames).
All deep content (pricing, regulatory, local context) is hand-rewritten in each page.

Run ONCE after robocopy from pakenhamdecking template.
"""
from __future__ import annotations
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SELF_NAME = Path(__file__).name

REPLACEMENTS = [
    ("https://pakenhamdecking.com.au", "https://goldcoastpoolbuilders.com.au"),
    ("https://pakenhamdecking.netlify.app", "https://goldcoastpoolbuilders.netlify.app"),
    ("pakenhamdecking.netlify.app", "goldcoastpoolbuilders.netlify.app"),
    ("pakenhamdecking.com.au", "goldcoastpoolbuilders.com.au"),
    ("pakenhamdecking", "goldcoastpoolbuilders"),
    ("Pakenham Decking &amp; Pergolas", "Gold Coast Pool Builders"),
    ("Pakenham Decking & Pergolas", "Gold Coast Pool Builders"),
    ("/officer/", "/mermaid-beach/"),
    ("/beaconsfield/", "/burleigh-heads/"),
    ("/cockatoo/", "/mudgeeraba/"),
    ("/emerald/", "/robina/"),
    ("/pakenham-upper/", "/helensvale/"),
    ("/cardinia-shire/", "/city-of-gold-coast/"),
    ("/services/timber-decking/", "/services/new-concrete-pools/"),
    ("/services/composite-decking/", "/services/fibreglass-pools/"),
    ("/services/pergolas/", "/services/pool-resurfacing/"),
    ("/services/alfresco-outdoor-kitchens/", "/services/equipment-upgrades/"),
    ("/services/deck-restoration/", "/services/pool-renovation/"),
    ("VIC 3810", "QLD 4217"),
    ('"VIC"', '"QLD"'),
    ('"3810"', '"4217"'),
    ("Pakenham VIC 3810", "Gold Coast QLD 4217"),
    ("3810", "4217"),
    ("-38.0814", "-28.0023"),
    ("145.4842", "153.4145"),
]

EXTENSIONS = {".astro", ".md", ".toml", ".mjs", ".json", ".xml", ".txt", ".html", ".css", ".js"}

def patch_file(p):
    try:
        s = p.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        return False
    out = s
    for old, new in REPLACEMENTS:
        out = out.replace(old, new)
    if out != s:
        p.write_text(out, encoding="utf-8")
        return True
    return False

def main():
    PAGES = ROOT / "src" / "pages"
    for old, new in [
        ("officer.astro", "mermaid-beach.astro"),
        ("beaconsfield.astro", "burleigh-heads.astro"),
        ("cockatoo.astro", "mudgeeraba.astro"),
        ("emerald.astro", "robina.astro"),
        ("pakenham-upper.astro", "helensvale.astro"),
        ("cardinia-shire.astro", "city-of-gold-coast.astro"),
    ]:
        o, n = PAGES / old, PAGES / new
        if o.exists() and not n.exists():
            o.rename(n); print(f"renamed: {old} -> {new}")

    SVC = PAGES / "services"
    for old, new in [
        ("timber-decking.astro", "new-concrete-pools.astro"),
        ("composite-decking.astro", "fibreglass-pools.astro"),
        ("pergolas.astro", "pool-resurfacing.astro"),
        ("alfresco-outdoor-kitchens.astro", "equipment-upgrades.astro"),
        ("deck-restoration.astro", "pool-renovation.astro"),
    ]:
        o, n = SVC / old, SVC / new
        if o.exists() and not n.exists():
            o.rename(n); print(f"renamed services/{old} -> {new}")

    changed = 0
    for p in ROOT.rglob("*"):
        if not p.is_file(): continue
        if p.suffix not in EXTENSIONS: continue
        if "node_modules" in p.parts or "dist" in p.parts: continue
        if p.name == SELF_NAME: continue
        if patch_file(p):
            changed += 1

    pkg = ROOT / "package.json"
    if pkg.exists():
        s = pkg.read_text(encoding="utf-8")
        s = s.replace('"name": "pakenhamdecking"', '"name": "goldcoastpoolbuilders"')
        pkg.write_text(s, encoding="utf-8")

    print(f"Done. {changed} files patched.")

if __name__ == "__main__":
    main()
