# Bar Automation Pipeline

This folder implements a modular 3-stage bar sales pipeline:

- `stage1_clean.py` — image preprocessing with OpenCV
- `stage2_extract.py` — Gemini few-shot JSON extraction
- `stage3_logic.py` — business validation and math
- `main_orchestrator.py` — runs the full pipeline

## Usage

1. Place an image in `bar_automation/inbox/`
2. Set `GOOGLE_API_KEY` or `GEMINI_API_KEY`
3. Run:

```bash
python bar_automation/main_orchestrator.py bar_automation/inbox/daily_sheet.jpg
```

Optional save:

```bash
python bar_automation/main_orchestrator.py bar_automation/inbox/daily_sheet.jpg --save-json bar_automation/processed/output.json
```
