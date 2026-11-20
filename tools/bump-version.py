"""Stamp a fresh ?v= version on every local CSS/JS link in index.html, so browsers never mix old and new files.
Run before committing a release:  python tools/bump-version.py"""
import re, time, pathlib

page = pathlib.Path(__file__).resolve().parent.parent / "index.html"
html = page.read_text(encoding="utf-8")
version = time.strftime("%Y%m%d%H%M")
html, n = re.subn(r'((?:href|src)="(?:css|js)/[^"?]+\.(?:css|js))(?:\?v=[^"]*)?"', rf'\1?v={version}"', html)
page.write_text(html, encoding="utf-8", newline="")
print(f"stamped {n} files with v={version}")
