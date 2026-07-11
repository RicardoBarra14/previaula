@echo off
REM PreviAula - arranque rapido (Windows)
cd /d "%~dp0"
if not exist ".venv" (
  echo Creando entorno virtual...
  python -m venv .venv
)
call .venv\Scripts\activate
echo Instalando dependencias...
pip install -q -r requirements.txt
echo Iniciando servidor en http://localhost:8000
cd backend
uvicorn main:app --reload
