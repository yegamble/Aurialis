# Seed Fixtures

Pre-encoded MP3 + M4A samples committed to git so `generate-fixtures.py` can
copy them into the parent `fixtures/` directory without depending on ffmpeg /
lame in the backend image.

The `validation.py` policy is magic-byte-only for MP3 + M4A — these seeds need
to satisfy magic-byte detection (`ID3` or 0xFF 0xFB for MP3; `ftyp` at offset
4 for M4A). They do not need to decode to real audio under Demucs/madmom,
because the current Postman test suite does not run ML on MP3/M4A fixtures.

Replace these with real encoded samples if you add MP3/M4A round-trip tests.
