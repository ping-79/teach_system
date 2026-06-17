@echo off
cd /d "%~dp0jiaoan"
set "DEEPSEEK_API_KEY_FILE=%~dp0..\jiaoan\deepseek_api_key.txt"
set "DEEPSEEK_BASE_URL=https://api.deepseek.com/chat/completions"
set "DEEPSEEK_MODEL=deepseek-reasoner"
set "JIAOAN_TEMPLATE_PATH=%~dp0jiaoan\教案空表模板.docx"
set "JIAOAN_OUTPUT_DIR=%~dp0jiaoan\output\jiaoan"
set "JIAOAN_TMP_DIR=%~dp0jiaoan\tmp\jiaoan"
set "JIAOAN_PYTHON_BIN=python"
node dist\main.js -p 3100
