"""Load python_app/.env on import so OPENROUTER_API_KEY is available to ocr.py.

Falls through silently when python-dotenv isn't installed (e.g. minimal envs).
"""

from pathlib import Path

try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).resolve().parent.parent / ".env")
except ImportError:
    pass
