@echo off
cd /d "%~dp0jiaoan"
set "DEEPSEEK_API_KEY_FILE=%~dp0jiaoan\deepseek_api_key.txt"
set "DEEPSEEK_BASE_URL=https://api.deepseek.com/chat/completions"
set "DEEPSEEK_MODEL=deepseek-v4-pro"
set "JIAOAN_TEMPLATE_PATH=%~dp0jiaoan\legacy-jiaoan-template.docx"
set "JIAOAN_OUTPUT_DIR=%~dp0jiaoan\output\jiaoan"
set "JIAOAN_TMP_DIR=%~dp0jiaoan\tmp\jiaoan"
set "JIAOAN_PYTHON_BIN=python"
node dist\main.js -p 3100
