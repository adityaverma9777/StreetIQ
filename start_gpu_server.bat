@echo off
cd /d "%~dp0backend"
python -m uvicorn gpu_server:app --host 0.0.0.0 --port 8000
