@echo off
echo ===================================================
echo   QuizBini Local TTS Server Setup & Starter
echo ===================================================
echo.

:: Check for python
python --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python was not found on your system PATH.
    echo Please install Python 3.10 or 3.11 and add it to PATH.
    pause
    exit /b
)

:: Create virtual environment if it doesn't exist
if not exist venv (
    echo Creating virtual environment...
    python -m venv venv
)

:: Activate virtual env and install requirements
echo Activating virtual environment...
call venv\Scripts\activate.bat

echo Installing dependencies (this may take a few minutes)...
pip install -r requirements.txt

echo.
echo Starting FastAPI Server on http://localhost:8000
echo.
python main.py

pause
