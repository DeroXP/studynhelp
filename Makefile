SHELL := /bin/bash

PY := python3
PIP := pip3

.ONESHELL:

.PHONY: setup backend frontend build bundle dev test lint docker

setup:
	$(PIP) install -r requirements.txt
	cd frontend && npm install

backend-run:
	uvicorn backend.main:app --host 0.0.0.0 --port 8080

frontend-build:
	cd frontend && npm run build

frontend-dev:
	cd frontend && npm run dev

build: frontend-build

bundle: frontend-build

 test:
	pytest -q

 dev:
	make -j2 backend-run frontend-dev

 docker:
	docker build -t studynhelp:latest .
