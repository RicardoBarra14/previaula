#!/usr/bin/env bash
# PreviAula — arranque rápido
set -e
cd "$(dirname "$0")"
if [ ! -d ".venv" ]; then
  echo "→ Creando entorno virtual…"
  python3 -m venv .venv
fi
source .venv/bin/activate
echo "→ Instalando dependencias…"
pip install -q -r requirements.txt
echo "→ Iniciando servidor en http://localhost:8000"
cd backend
uvicorn main:app --reload
