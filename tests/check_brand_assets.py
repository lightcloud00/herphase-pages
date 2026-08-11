#!/usr/bin/env python3
"""Validate HerPhase favicon provenance and social metadata on every HTML page."""

from __future__ import annotations

import hashlib
import json
import os
import struct
from html.parser import HTMLParser
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
FAVICON_ROOT = ROOT / "assets" / "favicon"
PROVENANCE_PATH = FAVICON_ROOT / "PROVENANCE.json"
OG_IMAGE_URL = "https://lightcloud00.github.io/herphase-pages/assets/og-card.png"
OG_IMAGE_SHA256 = "52272bc6ea15c520231ce228d5e285ed057e8b0572554f9f45f6cac910677904"
EXPECTED_SOURCE_SHA256 = "8f9c65ddc1737ae5da7bb1c4fac737d76e2a54921a7380d5a2f904f0d82a6ce1"
EXPECTED_HTML = [
    "blog/index.html",
    "blog/private-period-tracker-data/index.html",
    "blog/track-irregular-cycles/index.html",
    "blog/what-to-log-in-a-pms-tracker/index.html",
    "delete-account/index.html",
    "how-it-works/index.html",
    "index.html",
    "medical-disclosure/index.html",
    "privacy/index.html",
    "support/index.html",
    "terms/index.html",
]


class HeadParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.in_head = False
        self.links: list[dict[str, str]] = []
        self.meta: dict[str, list[str]] = {}

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = {key: value or "" for key, value in attrs}
        if tag == "head":
            self.in_head = True
            return
        if not self.in_head:
            return
        if tag == "link":
            self.links.append(values)
        elif tag == "meta":
            key = values.get("property") or values.get("name")
            if key:
                self.meta.setdefault(key, []).append(values.get("content", ""))

    def handle_endtag(self, tag: str) -> None:
        if tag == "head":
            self.in_head = False


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def png_dimensions(path: Path) -> tuple[int, int]:
    raw = path.read_bytes()[:24]
    require(raw[:8] == b"\x89PNG\r\n\x1a\n", f"not a PNG: {path}")
    return struct.unpack(">II", raw[16:24])


def ico_dimensions(path: Path) -> list[int]:
    raw = path.read_bytes()
    reserved, kind, count = struct.unpack_from("<HHH", raw, 0)
    require((reserved, kind) == (0, 1), f"not an ICO: {path}")
    sizes: list[int] = []
    for index in range(count):
        width, height = struct.unpack_from("BB", raw, 6 + index * 16)
        normalized_width = width or 256
        normalized_height = height or 256
        require(normalized_width == normalized_height, f"non-square ICO entry in {path}")
        sizes.append(normalized_width)
    return sizes


def relative_href(page: Path, target: Path) -> str:
    return Path(os.path.relpath(target, page.parent)).as_posix()


def single(values: dict[str, list[str]], key: str, page: Path) -> str:
    matches = values.get(key, [])
    require(len(matches) == 1, f"{page}: expected one {key}, got {len(matches)}")
    return matches[0]


def link_by_rel_and_sizes(
    links: list[dict[str, str]], rel: str, sizes: str | None = None
) -> list[dict[str, str]]:
    matches = [link for link in links if rel in link.get("rel", "").split()]
    if sizes is not None:
        matches = [link for link in matches if link.get("sizes") == sizes]
    return matches


def validate_page(relative: str) -> dict[str, Any]:
    page = ROOT / relative
    parser = HeadParser()
    parser.feed(page.read_text(encoding="utf-8"))

    expected_links = {
        ("icon", "any"): FAVICON_ROOT / "favicon.ico",
        ("icon", "32x32"): FAVICON_ROOT / "favicon-32x32.png",
        ("icon", "16x16"): FAVICON_ROOT / "favicon-16x16.png",
        ("apple-touch-icon", "180x180"): FAVICON_ROOT / "apple-touch-icon.png",
        ("manifest", None): ROOT / "site.webmanifest",
    }
    for (rel, sizes), target in expected_links.items():
        matches = link_by_rel_and_sizes(parser.links, rel, sizes)
        require(len(matches) == 1, f"{relative}: expected one {rel} {sizes}, got {len(matches)}")
        expected_href = relative_href(page, target)
        require(matches[0].get("href") == expected_href, f"{relative}: wrong {rel} path")
        resolved = (page.parent / matches[0]["href"]).resolve()
        require(resolved.is_relative_to(ROOT), f"{relative}: {rel} escapes repository")
        require(resolved.is_file(), f"{relative}: missing {rel} target {resolved}")

    declared_icons = [
        link.get("href", "")
        for link in parser.links
        if "icon" in link.get("rel", "").split()
    ]
    require(not any(href.endswith("brand-mark.svg") for href in declared_icons), f"{relative}: stale SVG favicon remains declared")

    canonical = [
        link.get("href", "")
        for link in parser.links
        if "canonical" in link.get("rel", "").split()
    ]
    require(len(canonical) == 1, f"{relative}: expected one canonical URL")
    require(single(parser.meta, "og:url", page) == canonical[0], f"{relative}: og:url differs from canonical")
    require(single(parser.meta, "og:image", page) == OG_IMAGE_URL, f"{relative}: wrong og:image")
    require(single(parser.meta, "og:image:width", page) == "1200", f"{relative}: wrong og:image width")
    require(single(parser.meta, "og:image:height", page) == "630", f"{relative}: wrong og:image height")
    require(single(parser.meta, "twitter:card", page) == "summary_large_image", f"{relative}: wrong Twitter card")
    require(single(parser.meta, "twitter:image", page) == OG_IMAGE_URL, f"{relative}: wrong twitter:image")
    for key in (
        "og:type",
        "og:title",
        "og:description",
        "og:image:alt",
        "og:site_name",
        "og:locale",
        "twitter:title",
        "twitter:description",
        "twitter:image:alt",
    ):
        require(bool(single(parser.meta, key, page).strip()), f"{relative}: empty {key}")

    return {
        "page": relative,
        "icon_links": len(declared_icons),
        "og_image": OG_IMAGE_URL,
        "social_dimensions": [1200, 630],
    }


def main() -> int:
    html = sorted(path.relative_to(ROOT).as_posix() for path in ROOT.rglob("*.html"))
    require(html == EXPECTED_HTML, f"HTML inventory drift: {html}")

    provenance = json.loads(PROVENANCE_PATH.read_text(encoding="utf-8"))
    require(provenance["source"]["sha256"] == EXPECTED_SOURCE_SHA256, "source AppIcon provenance drift")
    require(provenance["generator"]["creative_generation_used"] is False, "favicon must remain an exact source export")
    for name, details in provenance["outputs"].items():
        path = FAVICON_ROOT / name
        require(path.is_file(), f"missing favicon output: {name}")
        require(sha256(path) == details["sha256"], f"favicon hash drift: {name}")
        if path.suffix == ".png":
            require(png_dimensions(path) == (details["width"], details["height"]), f"favicon dimensions drift: {name}")
        else:
            require(ico_dimensions(path) == details["sizes"], f"ICO dimensions drift: {name}")

    require(sha256(ROOT / "favicon.ico") == provenance["outputs"]["favicon.ico"]["sha256"], "root favicon differs from ladder ICO")
    require(png_dimensions(ROOT / "assets" / "og-card.png") == (1200, 630), "OG card dimensions drift")
    require(sha256(ROOT / "assets" / "og-card.png") == OG_IMAGE_SHA256, "OG card hash drift")

    manifest = json.loads((ROOT / "site.webmanifest").read_text(encoding="utf-8"))
    manifest_sizes = {icon["sizes"] for icon in manifest["icons"]}
    require(manifest_sizes == {"32x32", "192x192", "512x512"}, "manifest icon ladder drift")
    require(not any(icon["src"].endswith(".svg") for icon in manifest["icons"]), "manifest still prioritizes stale SVG artwork")
    for icon in manifest["icons"]:
        require((ROOT / icon["src"]).is_file(), f"missing manifest icon: {icon['src']}")

    pages = [validate_page(relative) for relative in html]
    print(
        json.dumps(
            {
                "verdict": "PASS",
                "html_pages": len(pages),
                "favicon_source_sha256": EXPECTED_SOURCE_SHA256,
                "favicon_outputs": len(provenance["outputs"]),
                "og_card": {"dimensions": [1200, 630], "sha256": OG_IMAGE_SHA256},
                "pages": pages,
            },
            indent=2,
            sort_keys=True,
        )
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (AssertionError, KeyError, OSError, ValueError) as error:
        raise SystemExit(f"FAIL: {error}")
