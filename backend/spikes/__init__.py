"""M0 spikes: throwaway measurements that feed decisions D1 (LLM) and D4 (voice). Not imported by the app."""

import sys

# Windows consoles default to cp1252, which cannot print Mongolian.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
