#!/usr/bin/env python3
"""Smoke test ConCen in Playwright-managed modern browsers."""

from __future__ import annotations

import argparse
import contextlib
import functools
import http.server
import os
import socket
import socketserver
import sys
import threading
from pathlib import Path

from playwright.sync_api import Error as PlaywrightError
from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parent


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, format: str, *args: object) -> None:
        return


def free_port() -> int:
    with contextlib.closing(socket.socket(socket.AF_INET, socket.SOCK_STREAM)) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def start_server() -> tuple[socketserver.TCPServer, str]:
    port = free_port()
    handler = functools.partial(QuietHandler, directory=str(ROOT))
    server = socketserver.TCPServer(("127.0.0.1", port), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server, f"http://127.0.0.1:{port}/"


def assert_no_browser_messages(messages: list[str]) -> None:
    if messages:
        raise AssertionError("Browser errors/warnings:\n" + "\n".join(messages))


def smoke_desktop(browser_type, browser_name: str, url: str) -> None:
    browser = browser_type.launch(headless=True)
    try:
        page = browser.new_page(viewport={"width": 1440, "height": 900})
        messages: list[str] = []
        page.on("console", lambda msg: messages.append(f"console:{msg.type}:{msg.text}") if msg.type in {"error", "warning"} else None)
        page.on("pageerror", lambda exc: messages.append(f"pageerror:{exc}"))

        page.goto(url, wait_until="networkidle")
        page.wait_for_selector("#chartCanvas .node", timeout=5000)
        page.locator("#welcomeCloseButton").click()

        initial_nodes = page.locator("#chartCanvas .node").count()
        if initial_nodes != 1:
            raise AssertionError(f"Expected one initial node, got {initial_nodes}")

        page.locator("#titleInput").fill("Modern Smoke Root")
        page.wait_for_timeout(150)
        if "Modern Smoke Root" not in (page.locator("#chartCanvas").text_content() or ""):
            raise AssertionError("Title rename did not update rendered root text")

        page.locator("#chartCanvas").focus()
        page.keyboard.press("Enter")
        page.wait_for_timeout(250)
        if page.locator("#chartCanvas .node").count() <= initial_nodes:
            raise AssertionError("Enter did not create child node")

        page.locator("#commandPaletteButton").click()
        page.wait_for_selector("#commandPalette:not([hidden])", timeout=3000)
        page.locator("#commandInput").fill("save")
        page.wait_for_timeout(200)
        if page.locator("#commandResults button").count() < 1:
            raise AssertionError("Command palette returned no results")
        page.keyboard.press("Escape")

        page.locator(".mind-menu > summary").click()
        with page.expect_download(timeout=5000) as download_info:
            page.locator("#exportMindButton").click()
        download = download_info.value
        if not download.suggested_filename.endswith(".mind.json"):
            raise AssertionError(f"Unexpected export filename: {download.suggested_filename}")

        before_maps = page.locator("#mapSelect option").count()
        page.locator("#newMapButton").click()
        page.wait_for_timeout(250)
        after_maps = page.locator("#mapSelect option").count()
        if after_maps != before_maps + 1:
            raise AssertionError(f"New map count mismatch: {before_maps} -> {after_maps}")

        page.on("dialog", lambda dialog: dialog.accept())
        page.locator("#deleteMapButton").click()
        page.wait_for_timeout(250)
        final_maps = page.locator("#mapSelect option").count()
        if final_maps != before_maps:
            raise AssertionError(f"Delete map count mismatch: expected {before_maps}, got {final_maps}")

        page.reload(wait_until="networkidle")
        page.wait_for_selector("#chartCanvas .node", timeout=5000)
        if "Modern Smoke Root" not in (page.locator("#chartCanvas").text_content() or ""):
            raise AssertionError("Saved node missing after reload")

        assert_no_browser_messages(messages)
        print(f"{browser_name}: desktop PASS")
    finally:
        browser.close()


def smoke_mobile(browser_type, browser_name: str, url: str) -> None:
    browser = browser_type.launch(headless=True)
    try:
        mobile_options = {"viewport": {"width": 390, "height": 844}}
        if browser_name != "firefox":
            mobile_options.update({"is_mobile": True, "has_touch": True})
        page = browser.new_page(**mobile_options)
        messages: list[str] = []
        page.on("console", lambda msg: messages.append(f"console:{msg.type}:{msg.text}") if msg.type in {"error", "warning"} else None)
        page.on("pageerror", lambda exc: messages.append(f"pageerror:{exc}"))
        page.goto(url, wait_until="networkidle")
        page.wait_for_selector("#chartCanvas .node", timeout=5000)
        if page.locator("#chartCanvas .node").count() < 1:
            raise AssertionError("Mobile viewport rendered no nodes")
        assert_no_browser_messages(messages)
        print(f"{browser_name}: mobile PASS")
    finally:
        browser.close()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--browsers", nargs="+", default=["chromium", "firefox", "webkit"])
    parser.add_argument("--skip-unavailable", action="store_true")
    args = parser.parse_args()

    server, url = start_server()
    failures: list[str] = []
    try:
        with sync_playwright() as playwright:
            for browser_name in args.browsers:
                browser_type = getattr(playwright, browser_name)
                try:
                    smoke_desktop(browser_type, browser_name, url)
                    smoke_mobile(browser_type, browser_name, url)
                except (PlaywrightError, PlaywrightTimeoutError) as exc:
                    message = f"{browser_name}: unavailable or failed: {exc}"
                    if args.skip_unavailable:
                        print(message)
                    else:
                        failures.append(message)
                except AssertionError as exc:
                    failures.append(f"{browser_name}: {exc}")
    finally:
        server.shutdown()
        server.server_close()

    if failures:
        print("\n".join(failures), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    os.chdir(ROOT)
    raise SystemExit(main())
