@echo off
title TERA Server Sniffer
cd /d "%~dp0"

bin\node\node.exe --use-strict --harmony index.js
pause