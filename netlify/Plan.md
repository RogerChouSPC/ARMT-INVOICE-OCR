# ARMT Invoice OCR — Project Status

## Sprint 1 + Sprint 2: COMPLETE ✅

### What's working
- Server running at http://localhost:8000 (local) and http://10.109.109.11:8000 (LAN)
- Login with password: `admin123`
- 25 customers seeded in the database
- All API endpoints verified (auth, customers, invoices, export)
- Windows Firewall rule created for port 8000

### All bugs fixed
| # | Fix |
|---|-----|
| 1 | `requirements.txt` version pins updated for Python 3.14 |
| 2 | `passlib` → `bcrypt` direct (passlib incompatible with latest bcrypt) |
| 3 | `HTTPAuthCredentials` import fixed in 3 routers |
| 4 | CORS opened for LAN access |
| 5 | Root endpoint serves HTML |
| 6 | Seed script: duplicate tax_id handling + file path |
| 7 | Missing `python-multipart` installed |
| 8 | Gemini SDK: `google.generativeai` → `google.genai` (deprecated) |
| 9 | 12 lint errors fixed (unused imports + bare excepts) |

### To start the server
Double-click `start_server.bat` in the project folder, or run:
```
venv\Scripts\python.exe run.py --host 0.0.0.0 --port 8000
```

### Team access
Share this URL with your office team: **http://10.109.109.11:8000**

### Sprint 3 (next): Go live + train team
- Walk team through uploading an invoice PDF
- Verify Gemini OCR fallback works on scanned invoices
- Export to Excel and verify 22-column format

### Sprint 4 (optional): Cloud deployment
- Replace EasyOCR with Gemini-only to reduce RAM requirements
- Deploy to free tier (Render/Railway) for remote access
