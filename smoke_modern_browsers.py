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
THEME_OWNED_TOKENS = [
    "--bg",
    "--surface",
    "--surface-solid",
    "--surface-raised",
    "--surface-recessed",
    "--glass-border",
    "--hairline",
    "--field",
    "--field-hover",
    "--control",
    "--control-hover",
    "--control-pressed",
    "--control-ink",
    "--focus",
    "--focus-soft",
    "--path-glow",
    "--path-fill",
    "--sibling-glow",
    "--sibling-fill",
    "--ink",
    "--muted",
    "--label",
    "--canvas-bg",
    "--canvas-grid",
    "--canvas-wash",
    "--node-fill",
    "--node-ink",
    "--root-node-fill",
    "--root-node-ink",
    "--ring-guide",
]


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


def exercise_appearance_presets(page, *, check_overflow: bool = False) -> None:
    page.locator(".settings-menu > summary").click()
    page.wait_for_selector(".settings-menu[open] .settings-panel", timeout=3000)
    theme_values = page.locator("#themePresetInput option").evaluate_all("options => options.map(option => option.value)")
    style_values = page.locator("#stylePresetInput option").evaluate_all("options => options.map(option => option.value)")
    for theme in theme_values:
        if theme == "custom":
            continue
        page.locator("#themePresetInput").select_option(theme)
        page.wait_for_timeout(50)
        if page.locator("#themePresetInput").input_value() != theme:
            raise AssertionError(f"Theme preset did not stick: {theme}")
        if page.evaluate("document.documentElement.dataset.theme") not in {"light", "dark"}:
            raise AssertionError(f"Theme preset did not set color scheme: {theme}")
        theme_tokens = page.evaluate(
            """tokens => Object.fromEntries(tokens.map(token => [
                token,
                getComputedStyle(document.documentElement).getPropertyValue(token).trim()
            ]))""",
            THEME_OWNED_TOKENS,
        )
        for style in style_values:
            page.locator("#stylePresetInput").select_option(style)
            page.wait_for_timeout(50)
            if page.evaluate("document.documentElement.dataset.style") != style:
                raise AssertionError(f"Style preset did not set dataset: {style}")
            if page.locator("#chartCanvas .node").count() < 1:
                raise AssertionError(f"Style preset rendered no nodes: {style}")
            after_tokens = page.evaluate(
                """tokens => Object.fromEntries(tokens.map(token => [
                    token,
                    getComputedStyle(document.documentElement).getPropertyValue(token).trim()
                ]))""",
                THEME_OWNED_TOKENS,
            )
            if after_tokens != theme_tokens:
                raise AssertionError(f"Style {style} changed theme tokens for {theme}: {after_tokens} != {theme_tokens}")
    if check_overflow:
        overflow = page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
        if overflow > 1:
            raise AssertionError(f"Appearance controls overflow horizontally by {overflow}px")
    page.locator(".settings-menu > summary").click()


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
        page.keyboard.press("Control+Enter")
        page.locator("#noteInput").fill(
            "# Smoke note heading\n"
            "**Smoke note second line**\n"
            "- [x] Smoke checked item\n"
            "~~Smoke removed item~~\n"
            "==Smoke highlighted item==\n"
            "---\n"
            "[Smoke link](https://example.com)\n"
            "[[Modern Smoke Root|Root Link]]\n"
            "![Smoke image](https://example.com/image.png)"
        )
        page.wait_for_timeout(150)
        page.locator("#closeNoteButton").click()

        page.locator("#chartCanvas").focus()
        page.keyboard.press("Enter")
        page.wait_for_timeout(250)
        if page.locator("#chartCanvas .node").count() <= initial_nodes:
            raise AssertionError("Enter did not create child node")
        page.locator("#chartCanvas").focus()
        page.keyboard.press("Shift+ArrowUp")
        page.keyboard.press("Enter")
        page.wait_for_timeout(250)
        if page.locator("#chartCanvas .node").count() <= initial_nodes + 1:
            raise AssertionError("Second child node was not created")

        page.locator("#commandPaletteButton").click()
        page.wait_for_selector("#commandPalette:not([hidden])", timeout=3000)
        page.locator("#commandInput").fill("save")
        page.wait_for_timeout(200)
        if page.locator("#commandResults button").count() < 1:
            raise AssertionError("Command palette returned no results")
        page.keyboard.press("Escape")

        page.locator(".settings-menu > summary").click()
        page.wait_for_selector(".settings-menu[open] .settings-panel", timeout=3000)
        page.locator("#treeViewButton").click()
        if page.locator("#treeViewButton").get_attribute("aria-pressed") != "true":
            raise AssertionError("Flat view button did not activate")
        for button_id, mode, label in [
            ("#radialViewButton", "radial", "Radial"),
            ("#bookViewButton", "book", "Book"),
        ]:
            page.locator(button_id).click()
            page.wait_for_timeout(200)
            if page.locator(button_id).get_attribute("aria-pressed") != "true":
                raise AssertionError(f"{label} view button did not activate")
            if page.evaluate("document.documentElement.dataset.view") != mode:
                raise AssertionError(f"{label} view did not set dataset")
            if page.locator("#chartCanvas .node").count() < 3:
                raise AssertionError(f"{label} view rendered missing nodes")
            if mode == "book":
                canvas_text = page.locator("#chartCanvas").text_content() or ""
                expected_markdown_text = [
                    "Smoke note heading",
                    "Smoke note second line",
                    "☑ Smoke checked item",
                    "Smoke removed item",
                    "Smoke highlighted item",
                    "────────────────",
                    "Smoke link",
                    "Root Link",
                    "▣ Smoke image",
                ]
                if any(text not in canvas_text for text in expected_markdown_text):
                    raise AssertionError("Book view did not render full markdown note text")
                raw_markdown = ["# Smoke", "**Smoke note second line**", "- [x]", "~~Smoke", "==Smoke", "[Smoke link]", "[[Modern Smoke Root|Root Link]]", "![Smoke image]"]
                if any(text in canvas_text for text in raw_markdown):
                    raise AssertionError("Book view rendered raw markdown markers")
                if page.locator("#chartCanvas .markdown-link[role='link']").count() < 2:
                    raise AssertionError("Book view markdown links are not interactable")
        page.locator("#radialViewButton").click()
        page.wait_for_timeout(200)
        focused_before = page.locator("#chartCanvas .node.focused .node-label").text_content()
        page.locator("#chartCanvas").focus()
        page.keyboard.press("ArrowRight")
        page.wait_for_timeout(200)
        focused_after = page.locator("#chartCanvas .node.focused .node-label").text_content()
        if focused_before == focused_after:
            raise AssertionError("Radial view arrow navigation did not move focus")
        page.locator("#treeViewButton").click()
        if page.locator("#treeViewButton").get_attribute("aria-pressed") != "true":
            raise AssertionError("Flat view button did not reactivate after radial")
        page.locator(".settings-menu > summary").click()

        page.locator("#zoomInButton").click()
        page.locator("#zoomOutButton").click()
        page.locator("#fitViewButton").click()
        if "Fit view" not in (page.locator("#statusText").text_content() or ""):
            raise AssertionError("Fit view control did not update status")
        page.locator("#zoomInButton").click()
        page.wait_for_timeout(150)
        zoomed_viewbox = page.locator("#chartCanvas").get_attribute("viewBox")
        page.locator("#chartCanvas .node").nth(1).click()
        page.wait_for_timeout(150)
        focused_viewbox = page.locator("#chartCanvas").get_attribute("viewBox")
        if not zoomed_viewbox or not focused_viewbox:
            raise AssertionError("Missing viewBox after zoom/focus")
        zoomed_width = float(zoomed_viewbox.split()[2])
        focused_width = float(focused_viewbox.split()[2])
        if abs(zoomed_width - focused_width) > 0.01:
            raise AssertionError(f"Node focus changed zoom: {zoomed_width} -> {focused_width}")
        before_pan = page.locator("#chartCanvas").get_attribute("viewBox")
        page.locator("#chartCanvas").dispatch_event("wheel", {"deltaX": 80, "deltaY": 60, "bubbles": True, "cancelable": True})
        page.wait_for_timeout(150)
        after_pan = page.locator("#chartCanvas").get_attribute("viewBox")
        if not before_pan or not after_pan:
            raise AssertionError("Missing viewBox after trackpad pan")
        before_x, before_y, before_width = [float(value) for value in before_pan.split()[:3]]
        after_x, after_y, after_width = [float(value) for value in after_pan.split()[:3]]
        if abs(after_width - before_width) > 0.01:
            raise AssertionError(f"Trackpad pan changed zoom: {before_width} -> {after_width}")
        if abs(after_x - before_x) < 0.5 or abs(after_y - before_y) < 0.5:
            raise AssertionError(f"Trackpad pan did not move both axes: {before_pan} -> {after_pan}")

        page.locator(".settings-menu > summary").click()
        page.locator("[data-layout-preset='wide']").click()
        page.wait_for_timeout(150)
        if page.locator("#ringBaseRadiusInput").input_value() != "155":
            raise AssertionError("Layout preset did not update number input")
        if page.locator("#ringBaseRadiusRange").input_value() != "155":
            raise AssertionError("Layout preset did not update range input")
        page.locator("#ringNodeGapRange").fill("40")
        page.wait_for_timeout(150)
        if page.locator("#ringNodeGapInput").input_value() != "40":
            raise AssertionError("Range control did not sync number input")
        page.locator(".settings-menu > summary").click()
        exercise_appearance_presets(page)

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
        page.locator("#welcomeCloseButton").click()
        if page.locator("#chartCanvas .node").count() < 1:
            raise AssertionError("Mobile viewport rendered no nodes")
        page.locator(".settings-menu > summary").click()
        page.wait_for_selector(".settings-menu[open] .settings-panel", timeout=3000)
        settings_height = page.locator(".settings-panel").evaluate("el => el.getBoundingClientRect().height")
        if settings_height < 240:
            raise AssertionError(f"Mobile settings panel collapsed: {settings_height}")
        page.locator(".settings-menu > summary").click()
        exercise_appearance_presets(page, check_overflow=True)
        page.set_viewport_size({"width": 320, "height": 700})
        page.wait_for_timeout(150)
        overflow = page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
        if overflow > 1:
            raise AssertionError(f"Mobile toolbar overflows horizontally by {overflow}px")
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
