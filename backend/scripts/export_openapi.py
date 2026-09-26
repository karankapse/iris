"""Writes backend/openapi.json. The frontend generates its TypeScript API types from it.

Run from the repo root with `make gen-types` (which calls `python -m scripts.export_openapi`).
"""

import json
import tempfile
from pathlib import Path

from app.config import Settings
from app.main import create_app

# Use a throwaway DB so exporting the schema never touches real data.
with tempfile.TemporaryDirectory() as tmp:
    app = create_app(Settings(database_path=Path(tmp) / "x.db", anthropic_api_key=""))
    schema = app.openapi()

out = Path(__file__).resolve().parents[1] / "openapi.json"
out.write_text(json.dumps(schema, indent=2, sort_keys=True) + "\n")
print(f"wrote {out}")
