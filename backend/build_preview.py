import re
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
index_path = BASE / "frontend" / "index.html"
css_path = BASE / "frontend" / "style.css"
mock_path = BASE / "frontend" / "mock-data.js"
app_path = BASE / "frontend" / "app.js"
out_path = BASE / "PreviAula_preview.html"

def build():
    # Read inputs
    index_html = index_path.read_text(encoding="utf-8")
    css_content = css_path.read_text(encoding="utf-8")
    mock_content = mock_path.read_text(encoding="utf-8")
    app_content = app_path.read_text(encoding="utf-8")

    # Force offline mock in the preview file
    app_content = "window.PREVIAULA_FORCE_MOCK = true;\n" + app_content

    # Replace css link
    index_html = index_html.replace(
        '<link rel="stylesheet" href="style.css">',
        f"<style>\n{css_content}\n</style>"
    )

    # Replace mock-data.js script
    index_html = index_html.replace(
        '<script src="mock-data.js"></script>',
        f"<script>\n{mock_content}\n</script>"
    )

    # Replace app.js script
    index_html = index_html.replace(
        '<script src="app.js"></script>',
        f"<script>\n{app_content}\n</script>"
    )

    out_path.write_text(index_html, encoding="utf-8")
    print(f"[OK] PreviAula_preview.html compiled successfully: {out_path.stat().st_size / 1024:.1f} KB")

if __name__ == "__main__":
    build()
