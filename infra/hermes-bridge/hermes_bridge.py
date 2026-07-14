#!/usr/bin/env python3
"""Tailnet-only authenticated proxy for the local Hermes WebUI API."""

from __future__ import annotations

import hmac
import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

WEBUI_URL = os.environ.get("HERMES_WEBUI_URL", "http://127.0.0.1:8787").rstrip("/")
WEBUI_DIR = Path(os.environ.get("HERMES_WEBUI_DIR", "/home/forbes/hermes-webui"))
BRIDGE_TOKEN = os.environ["HERMES_BRIDGE_TOKEN"]
MAX_BODY_BYTES = 1_000_000

GET_PATHS = frozenset({
    "/health", "/api/sessions", "/api/session", "/api/models",
    "/api/chat/cancel", "/api/approval/pending",
    "/api/crons", "/api/crons/output", "/api/crons/history", "/api/crons/recent",
    "/api/crons/status", "/api/crons/delivery-options",
})
POST_PATHS = frozenset({
    "/api/session/new", "/api/chat/start", "/api/chat/steer",
    "/api/approval/respond", "/api/crons/create",
    "/api/crons/update", "/api/crons/delete", "/api/crons/run", "/api/crons/pause",
    "/api/crons/resume",
})


def webui_password() -> str:
    """Read the existing WebUI password without returning it to a client."""
    for line in (WEBUI_DIR / ".env").read_text().splitlines():
        key, separator, value = line.partition("=")
        if separator and key.strip() == "HERMES_WEBUI_PASSWORD":
            return value.strip().strip('"').strip("'")
    raise RuntimeError("HERMES_WEBUI_PASSWORD is not set in the Hermes WebUI environment")


def webui_session() -> tuple[str, str]:
    request = Request(
        f"{WEBUI_URL}/api/auth/login",
        data=json.dumps({"password": webui_password()}).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urlopen(request, timeout=10) as response:
        cookie = response.headers.get("Set-Cookie", "").split(";", 1)[0]
    if "=" not in cookie:
        raise RuntimeError("Hermes WebUI login did not return a session cookie")

    sys.path.insert(0, str(WEBUI_DIR))
    from api.auth import csrf_token_for_session  # noqa: PLC0415

    return cookie, csrf_token_for_session(cookie.split("=", 1)[1])


class BridgeHandler(BaseHTTPRequestHandler):
    server_version = "hermes-bridge/1"

    def log_message(self, *_args: object) -> None:
        return

    def _authorized(self) -> bool:
        value = self.headers.get("Authorization", "")
        return value.startswith("Bearer ") and hmac.compare_digest(value[7:], BRIDGE_TOKEN)

    def _reply(self, status: int, body: bytes, content_type: str = "application/json") -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _proxy(self, method: str) -> None:
        parsed = urlsplit(self.path)
        allowed = GET_PATHS if method == "GET" else POST_PATHS
        if parsed.path not in allowed:
            self._reply(404, b'{"error":"Unknown bridge endpoint"}')
            return
        if not self._authorized():
            self._reply(401, b'{"error":"Unauthorized"}')
            return

        body = b""
        if method == "POST":
            length = int(self.headers.get("Content-Length", "0"))
            if length > MAX_BODY_BYTES:
                self._reply(413, b'{"error":"Request body too large"}')
                return
            body = self.rfile.read(length)
        try:
            cookie, csrf = webui_session()
            request = Request(
                f"{WEBUI_URL}{self.path}",
                data=body if method == "POST" else None,
                headers={
                    "Cookie": cookie,
                    "Content-Type": "application/json",
                    "Origin": WEBUI_URL,
                    "X-CSRF-Token": csrf,
                },
                method=method,
            )
            with urlopen(request, timeout=90) as response:
                self._reply(response.status, response.read(), response.headers.get_content_type())
        except HTTPError as error:
            self._reply(error.code, error.read())
        except Exception as error:  # never leak host configuration or credentials
            self._reply(502, json.dumps({"error": f"Hermes bridge request failed: {type(error).__name__}"}).encode())

    def do_GET(self) -> None:
        if self.path == "/health":
            self._reply(200, b'{"status":"ok"}')
            return
        self._proxy("GET")

    def do_POST(self) -> None:
        self._proxy("POST")


if __name__ == "__main__":
    host = os.environ.get("HERMES_BRIDGE_HOST", "100.122.147.69")
    port = int(os.environ.get("HERMES_BRIDGE_PORT", "8788"))
    ThreadingHTTPServer((host, port), BridgeHandler).serve_forever()
