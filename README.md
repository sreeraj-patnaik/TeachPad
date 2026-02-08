# Realtime Dual-Screen Drawing Tablet

Phone browser = zoomable drawing tablet (input). Laptop browser = fullscreen display (output). No canvas zoom transforms; camera model in math only. Single finger = draw; two fingers = pan + pinch zoom.

## Setup

1. Create venv and install: `pip install -r requirements.txt`
2. Run Redis (required for Channels): e.g. `redis-server`
3. Run with Daphne (WebSocket support): `daphne -b 0.0.0.0 -p 8000 config.asgi:application`

## Usage

- Open **/display/** on the laptop (fullscreen canvas).
- Open **/phone/** on the phone (tablet with toolbar).
- Draw with one finger; pan/zoom with two fingers. Strokes appear on the display in real time.

## Tech

- Django + Django Channels (WebSocket)
- Redis channel layer
- Vanilla HTML/CSS/JS; no React, no drawing libraries

