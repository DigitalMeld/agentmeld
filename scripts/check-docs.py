"""Check local Markdown links without network access or third-party dependencies."""
from pathlib import Path
import re

root = Path(__file__).resolve().parents[1]
files = [root / "README.md", root / "CONTRIBUTING.md", root / "AGENTS.md", *sorted((root / "docs").rglob("*.md"))]
errors = []
for file in files:
    content = file.read_text()
    if content.count("```") % 2:
        errors.append(f"{file.relative_to(root)}: unmatched code fence")
    for target in re.findall(r"\]\(([^)]+)\)", content):
        if target.startswith(("https://", "http://", "mailto:", "#")):
            continue
        if not (file.parent / target.split("#", 1)[0]).exists():
            errors.append(f"{file.relative_to(root)}: missing {target}")
if errors:
    raise SystemExit("\n".join(errors))
print(f"Validated local links and fences in {len(files)} Markdown files")
