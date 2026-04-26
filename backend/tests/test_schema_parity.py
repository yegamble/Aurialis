"""
Schema parity test (T1/T2) — proves the shared mastering-script fixture
validates against the JSON Schema from the backend side. The frontend ships
the same fixture through ajv (see src/types/__tests__/deep-mastering.test.ts).
If either side drifts from the schema, CI fails on both repos.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
SCHEMA_PATH = ROOT / "schemas" / "mastering_script.schema.json"
FIXTURE_PATH = ROOT / "tests" / "fixtures" / "mastering_script_minimal.json"


def _load_json(p: Path) -> object:
    with p.open("r", encoding="utf-8") as f:
        return json.load(f)


@pytest.mark.unit
def test_schema_loads_and_compiles() -> None:
    """The committed JSON Schema is well-formed."""
    jsonschema = pytest.importorskip("jsonschema")
    schema = _load_json(SCHEMA_PATH)
    # Draft-07 metaschema validation
    jsonschema.Draft7Validator.check_schema(schema)


@pytest.mark.unit
def test_minimal_fixture_validates_against_schema() -> None:
    """The shared fixture passes server-side validation."""
    jsonschema = pytest.importorskip("jsonschema")
    schema = _load_json(SCHEMA_PATH)
    fixture = _load_json(FIXTURE_PATH)
    jsonschema.validate(instance=fixture, schema=schema)  # raises on failure


@pytest.mark.unit
def test_fixture_missing_version_fails() -> None:
    jsonschema = pytest.importorskip("jsonschema")
    schema = _load_json(SCHEMA_PATH)
    fixture = _load_json(FIXTURE_PATH)
    assert isinstance(fixture, dict)
    fixture.pop("version", None)
    with pytest.raises(jsonschema.exceptions.ValidationError):
        jsonschema.validate(instance=fixture, schema=schema)


@pytest.mark.unit
def test_fixture_unknown_param_fails() -> None:
    jsonschema = pytest.importorskip("jsonschema")
    schema = _load_json(SCHEMA_PATH)
    fixture = _load_json(FIXTURE_PATH)
    assert isinstance(fixture, dict)
    fixture["moves"][0]["param"] = "master.bogus.nope"
    with pytest.raises(jsonschema.exceptions.ValidationError):
        jsonschema.validate(instance=fixture, schema=schema)
