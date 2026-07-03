#!/usr/bin/env python3
"""Smoke test ConCen in Playwright-managed modern browsers."""

from __future__ import annotations

import argparse
import contextlib
import functools
import http.server
import json
import os
import socket
import socketserver
import sys
import tempfile
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
    if not check_overflow:
        custom_theme_button = page.locator("#themePresetDropdown .custom-select-button")
        custom_theme_button.click()
        page.wait_for_selector("#themePresetDropdown .custom-select-list:not([hidden])", timeout=3000)
        if page.locator("#themePresetDropdown .custom-select-group").count() < 3:
            raise AssertionError("Theme variants were not grouped in custom dropdown")
        if page.locator('#themePresetDropdown .custom-select-option[data-value="sand"]').count() != 1:
            raise AssertionError("Sand theme did not appear in theme dropdown")
        page.locator('#themePresetDropdown .custom-select-option[data-value="oxide"]').click()
        page.wait_for_timeout(50)
        if page.locator("#themePresetInput").input_value() != "oxide":
            raise AssertionError("Custom theme dropdown did not select Oxide")
        if "Oxide" not in custom_theme_button.text_content():
            raise AssertionError("Custom theme dropdown label did not update")
        custom_style_button = page.locator("#stylePresetDropdown .custom-select-button")
        custom_style_button.click()
        page.wait_for_selector("#stylePresetDropdown .custom-select-list:not([hidden])", timeout=3000)
        if page.locator("#stylePresetDropdown .custom-select-group").count() < 3:
            raise AssertionError("Style presets were not grouped in custom dropdown")
        if page.locator('#stylePresetDropdown .custom-select-option[data-value="dust"]').count() != 1:
            raise AssertionError("Dust style did not appear in style dropdown")
        page.locator("#stylePresetInput").evaluate(
            "(select) => { select.value = 'dust'; select.dispatchEvent(new Event('change', { bubbles: true })); }"
        )
        dust_edge = page.locator("#chartCanvas").evaluate(
            """svg => {
                const ns = 'http://www.w3.org/2000/svg';
                const stroke = document.createElementNS(ns, 'path');
                stroke.setAttribute('class', 'dust-edge');
                svg.append(stroke);
                const result = {
                    display: getComputedStyle(stroke).display,
                    filter: getComputedStyle(stroke).filter,
                    width: getComputedStyle(stroke).strokeWidth
                };
                stroke.remove();
                return result;
            }"""
        )
        if dust_edge["display"] != "block" or "dust-edge-grain" not in dust_edge["filter"] or not dust_edge["width"].endswith("px"):
            raise AssertionError(f"Dust SVG edge styling did not apply: {dust_edge}")
        page.keyboard.press("Escape")
        page.locator("#backgroundEffectDropdown .custom-select-button").click()
        page.wait_for_selector("#backgroundEffectDropdown .custom-select-list:not([hidden])", timeout=3000)
        if page.locator('#backgroundEffectDropdown .custom-select-option[data-value="waves"]').count() != 0:
            raise AssertionError("Scrapped Waves background still appeared in dropdown")
        if page.locator('#backgroundEffectDropdown .custom-select-option[data-value="circles"]').count() != 1:
            raise AssertionError("Circles background did not appear in dropdown")
        page.locator('#backgroundEffectDropdown .custom-select-option[data-value="spirits"]').click()
        page.wait_for_timeout(50)
        if page.evaluate("document.documentElement.dataset.background") != "spirits":
            raise AssertionError("Spirits background did not set dataset")
        if page.locator("#chartCanvas").evaluate("el => getComputedStyle(el).animationName") != "spiritsDrift":
            raise AssertionError("Spirits background animation did not apply")
        page.locator("#backgroundEffectInput").evaluate(
            "(select) => { select.value = 'circles'; select.dispatchEvent(new Event('change', { bubbles: true })); }"
        )
        page.wait_for_timeout(50)
        if page.evaluate("document.documentElement.dataset.background") != "circles":
            raise AssertionError("Circles background did not set dataset")
        circle_background = page.locator("#chartCanvas").evaluate(
            "el => ({ animationName: getComputedStyle(el).animationName, backgroundImage: getComputedStyle(el).backgroundImage })"
        )
        if circle_background["animationName"] != "none" or "repeating-radial-gradient" not in circle_background["backgroundImage"]:
            raise AssertionError("Circles background did not render as static radial texture")
        if page.evaluate("window.RingMapChart.storage.normalizeBackgroundEffect('waves')") != "circles":
            raise AssertionError("Legacy Waves background did not normalize to Circles")
        page.locator("#documentViewButton").click()
        page.wait_for_timeout(50)
        circle_book = page.locator("#chartCanvas").evaluate(
            "el => ({ animationName: getComputedStyle(el).animationName, backgroundImage: getComputedStyle(el).backgroundImage })"
        )
        if circle_book["animationName"] != "none" or "repeating-radial-gradient" not in circle_book["backgroundImage"]:
            raise AssertionError("Circles background did not render in Book view")
        page.locator("#radialViewButton").click()
        page.wait_for_timeout(50)
        page.locator("#backgroundEffectDropdown .custom-select-button").click()
        page.locator('#backgroundEffectDropdown .custom-select-option[data-value="dunes"]').click()
        page.wait_for_timeout(50)
        if page.evaluate("document.documentElement.dataset.background") != "dunes":
            raise AssertionError("Dunes background did not set dataset")
        dunes_background = page.locator("#chartCanvas").evaluate("el => getComputedStyle(el).backgroundImage")
        if "repeating-radial-gradient" in dunes_background or "repeating-linear-gradient" in dunes_background:
            raise AssertionError("Dunes background should not tile dust texture")
        if dunes_background.count("radial-gradient") < 4:
            raise AssertionError("Dunes background did not apply full-canvas dusty wash")
        if page.locator(".canvas-wrap").evaluate("el => getComputedStyle(el, '::before').display") != "none":
            raise AssertionError("Dunes background should not use overlay")
        page.locator("#documentViewButton").click()
        page.wait_for_timeout(50)
        document_dunes_background = page.locator("#chartCanvas").evaluate("el => getComputedStyle(el).backgroundImage")
        if not document_dunes_background.startswith("radial-gradient") or document_dunes_background.count("radial-gradient") < 4:
            raise AssertionError("Dunes background was hidden by Book layout page background")
        page.locator("#radialViewButton").click()
        page.wait_for_timeout(50)
        page.locator("#backgroundEffectDropdown .custom-select-button").click()
        page.locator('#backgroundEffectDropdown .custom-select-option[data-value="image"]').click()
        page.wait_for_selector("#backgroundImageUpload:not([hidden])", timeout=3000)
        with tempfile.NamedTemporaryFile("wb", suffix=".png", delete=False) as image_file:
            image_file.write(bytes.fromhex("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c63f8ffff3f0005fe02fea73581e70000000049454e44ae426082"))
            image_path = image_file.name
        try:
            page.locator("#backgroundImageInput").set_input_files(image_path)
            page.wait_for_timeout(250)
            if page.evaluate("document.documentElement.dataset.background") != "image":
                raise AssertionError("Image background did not set dataset")
            if "data:image/png" not in page.locator("#chartCanvas").evaluate("el => getComputedStyle(el).backgroundImage"):
                raise AssertionError("Image background did not apply uploaded data URL")
        finally:
            Path(image_path).unlink(missing_ok=True)
    for theme in theme_values:
        if theme == "custom":
            continue
        page.locator("#themePresetInput").evaluate(
            "(select, value) => { select.value = value; select.dispatchEvent(new Event('change', { bubbles: true })); }",
            theme,
        )
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
            page.locator("#stylePresetInput").evaluate(
                "(select, value) => { select.value = value; select.dispatchEvent(new Event('change', { bubbles: true })); }",
                style,
            )
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
        if page.locator("#welcomeDialog .welcome-logo").count() != 1:
            raise AssertionError("Welcome dialog did not render logo")
        if "ConCen" not in (page.locator("#welcomeDialog").text_content() or ""):
            raise AssertionError("Welcome dialog did not render title")
        welcome_text = page.locator("#welcomeDialog").text_content() or ""
        for expected in ["Start with Template", "Take 3-Minute Tutorial", "Blank Mind"]:
            if expected not in welcome_text:
                raise AssertionError(f"Welcome dialog missing {expected}")
        page.locator("#welcomeCloseButton").click()
        page.locator("#brandLogoButton").click()
        page.wait_for_selector("#welcomeDialog:not([hidden])", timeout=3000)
        page.locator("#welcomeCloseButton").click()
        page.locator("#shortcutSheetButton").click()
        page.wait_for_selector("#shortcutSheet:not([hidden])", timeout=3000)
        shortcut_text = page.locator("#shortcutSheet").text_content() or ""
        for expected in ["Ctrl K", "Arrows / WASD / HJKL", "Ctrl wheel", "Ctrl click", "Double click"]:
            if expected not in shortcut_text:
                raise AssertionError(f"Shortcut sheet missing {expected}")
        page.locator("#shortcutSheetCloseButton").click()
        page.wait_for_timeout(100)
        page.keyboard.press("Control+K")
        page.wait_for_selector("#commandPalette:not([hidden])", timeout=3000)
        page.locator("#commandInput").fill("zzzz-no-command")
        if "Try node label, action name, or status" not in (page.locator("#commandResults").text_content() or ""):
            raise AssertionError("Command palette no-results hint missing")
        page.keyboard.press("Escape")

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
            "```js\n"
            "const total = items.length;\n"
            "return total;\n"
            "```\n"
            "---\n"
            "| Metric | Value |\n"
            "| --- | --- |\n"
            "| Speed | Fast |\n"
            "| Item | Owner | Status | Due | Risk |\n"
            "| --- | --- | --- | --- | --- |\n"
            "| API | Ash | Active | Friday | Low |\n"
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

        page.locator(".mind-menu > summary").click()
        page.locator(".github-sync > summary").click()
        page.wait_for_selector("#githubOwnerInput", timeout=3000)
        page.locator("#githubOwnerInput").fill("octocat")
        page.locator("#githubRepoInput").fill("private-minds")
        page.locator("#githubPathInput").fill("minds/smoke.mind.json")
        if page.locator("#githubPushButton").count() != 1 or page.locator("#githubPullButton").count() != 1:
            raise AssertionError("GitHub sync controls did not render")
        with page.expect_download(timeout=5000) as sync_download_info:
            page.locator("#githubExportSettingsButton").click()
        sync_download = sync_download_info.value
        if not sync_download.suggested_filename.endswith(".concen-github-sync.json"):
            raise AssertionError(f"Unexpected GitHub settings filename: {sync_download.suggested_filename}")
        with tempfile.NamedTemporaryFile("w", suffix=".concen-github-sync.json", delete=False) as settings_file:
            json.dump({
                "type": "concen-github-sync",
                "version": 1,
                "owner": "monalisa",
                "repo": "shared-minds",
                "branch": "main",
                "path": "minds/imported.mind.json"
            }, settings_file)
            settings_path = settings_file.name
        try:
            page.locator("#githubImportSettingsInput").set_input_files(settings_path)
            page.wait_for_timeout(250)
            if page.locator("#githubOwnerInput").input_value() != "monalisa":
                raise AssertionError("GitHub settings import did not update owner")
        finally:
            Path(settings_path).unlink(missing_ok=True)
        page.locator(".mind-menu > summary").click()

        page.locator(".settings-menu > summary").click()
        page.wait_for_selector(".settings-menu[open] .settings-panel", timeout=3000)
        page.locator("#treeViewButton").click()
        if page.locator("#treeViewButton").get_attribute("aria-pressed") != "true":
            raise AssertionError("Flat view button did not activate")
        page.locator("#layoutSettingsButton").click()
        page.wait_for_selector("#layoutSettingsPanel:not([hidden])", timeout=3000)
        if page.locator('[data-spacing-key="ringBaseRadius"]').is_visible():
            raise AssertionError("Flat layout showed radial radius setting")
        if not page.locator('[data-spacing-key="treeLevelGap"]').is_visible():
            raise AssertionError("Flat layout hid layer spacing")
        page.keyboard.press("Escape")
        for button_id, mode, label in [
            ("#radialViewButton", "radial", "Radial"),
            ("#bookViewButton", "book", "Tree"),
            ("#documentViewButton", "document", "Book"),
        ]:
            page.locator(button_id).click()
            page.wait_for_timeout(200)
            if page.locator(button_id).get_attribute("aria-pressed") != "true":
                raise AssertionError(f"{label} view button did not activate")
            if page.evaluate("document.documentElement.dataset.view") != mode:
                raise AssertionError(f"{label} view did not set dataset")
            page.locator("#layoutSettingsButton").click()
            page.wait_for_selector("#layoutSettingsPanel:not([hidden])", timeout=3000)
            if mode == "radial":
                if not page.locator('[data-spacing-key="ringBaseRadius"]').is_visible():
                    raise AssertionError("Radial layout hid center radius")
                if page.locator('[data-spacing-key="treeLevelGap"]').is_visible():
                    raise AssertionError("Radial layout showed flat layer spacing")
            if mode == "book":
                if page.locator('[data-spacing-key="ringNodeGap"]').is_visible():
                    raise AssertionError("Tree layout showed radial node spacing")
                if not page.locator('[data-spacing-key="treeLeafGap"]').is_visible():
                    raise AssertionError("Tree layout hid column spacing")
            if mode == "document":
                if page.locator('[data-spacing-key="ringNodeGap"]').is_visible():
                    raise AssertionError("Book document layout showed radial node spacing")
                if page.locator('[data-spacing-key="treeLeafGap"]').is_visible():
                    raise AssertionError("Book document layout showed column spacing")
                if not page.locator('[data-spacing-key="treeLevelGap"]').is_visible():
                    raise AssertionError("Book document layout hid paragraph spacing")
            page.keyboard.press("Escape")
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
                    "const total = items.length;",
                    "return total;",
                    "────────────────",
                    "Metric",
                    "Value",
                    "Speed",
                    "Fast",
                    "API",
                    "Owner: Ash",
                    "Status: Active",
                    "Due: Friday",
                    "Risk: Low",
                    "Smoke link",
                    "Root Link",
                    "▣ Smoke image",
                ]
                if any(text not in canvas_text for text in expected_markdown_text):
                    raise AssertionError("Book view did not render full markdown note text")
                raw_markdown = ["# Smoke", "**Smoke note second line**", "- [x]", "~~Smoke", "==Smoke", "```", "```js", "| --- | --- |", "—  •  —", "[Smoke link]", "[[Modern Smoke Root|Root Link]]", "![Smoke image]"]
                if any(text in canvas_text for text in raw_markdown):
                    raise AssertionError("Book view rendered raw markdown markers")
                if page.locator("#chartCanvas .markdown-code-block").count() < 2:
                    raise AssertionError("Book view did not render fenced code block lines")
                if page.locator("#chartCanvas .markdown-table-primary").count() < 2:
                    raise AssertionError("Book view did not emphasize table primary cells")
                if page.locator("#chartCanvas .markdown-table-meta").count() < 1:
                    raise AssertionError("Book view did not render wide markdown table as row-card metadata")
                if page.locator("#chartCanvas .markdown-link[role='link']").count() < 2:
                    raise AssertionError("Tree view markdown links are not interactable")
            if mode == "document":
                if page.locator("#chartCanvas .node.view-document.role-doc-title").count() != 1:
                    raise AssertionError("Book document view did not render document title")
                if page.locator("#chartCanvas .node.view-document.role-section").count() < 1:
                    raise AssertionError("Book document view did not render sections")
                document_left_edges = page.evaluate(
                    """() => Array.from(document.querySelectorAll('#chartCanvas .node.view-document.role-doc-title, #chartCanvas .node.view-document.role-section'))
                        .slice(0, 3)
                        .map(node => node.getBBox().x)"""
                )
                if max(document_left_edges) - min(document_left_edges) > 2:
                    raise AssertionError(f"Book document nodes are not left aligned: {document_left_edges}")
                if page.locator("#chartCanvas .edge").first.is_visible():
                    raise AssertionError("Book document view showed map edges")
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
        if page.locator("#nodeActionBar").get_attribute("hidden") is not None:
            raise AssertionError("Node focus control did not open after node click")
        page.locator("#chartCanvas").dispatch_event("pointerdown", {"button": 0, "bubbles": True})
        page.wait_for_timeout(100)
        if page.locator("#nodeActionBar").get_attribute("hidden") is not None:
            raise AssertionError("Background click dismissed focus control")
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
        page.wait_for_selector(".settings-menu[open] .settings-panel", timeout=3000)
        menu_style = page.locator(".settings-panel").evaluate("el => ({ maxHeight: getComputedStyle(el).maxHeight, overflowY: getComputedStyle(el).overflowY })")
        if menu_style["overflowY"] != "auto" or menu_style["maxHeight"] == "none":
            raise AssertionError(f"Settings panel did not have bounded scrolling: {menu_style}")
        page.locator("#radialViewButton").click()
        page.locator("[data-layout-preset='wide']").click()
        page.wait_for_timeout(150)
        if page.locator("#ringBaseRadiusInput").input_value() != "155":
            raise AssertionError("Layout preset did not update number input")
        if page.locator("#ringBaseRadiusRange").input_value() != "155":
            raise AssertionError("Layout preset did not update range input")
        page.locator("#layoutSettingsButton").click()
        page.wait_for_selector("#layoutSettingsPanel:not([hidden])", timeout=3000)
        page.locator("#ringNodeGapRange").fill("40")
        page.wait_for_timeout(150)
        if page.locator("#ringNodeGapInput").input_value() != "40":
            raise AssertionError("Range control did not sync number input")
        page.keyboard.press("Escape")
        page.locator(".settings-menu > summary").click()
        page.locator(".mind-menu > summary").click()
        page.locator(".trust-data > summary").click()
        page.locator("#authorDisplayNameInput").fill("Smoke Tester")
        page.locator("#saveAuthorProfileButton").click()
        page.wait_for_timeout(150)
        trust_text = page.locator("#trustDataSummary").text_content() or ""
        for expected in ["Schema v2", "Smoke Tester", "No completed sync"]:
            if expected not in trust_text:
                raise AssertionError(f"Trust/Data summary missing {expected}: {trust_text}")
        page.locator("#trustRecoveryButton").click()
        page.wait_for_timeout(150)
        page.locator(".mind-menu > summary").click()
        exercise_appearance_presets(page)

        page.locator(".mind-menu > summary").click()
        with page.expect_download(timeout=5000) as download_info:
            page.locator("#exportMindButton").click()
        download = download_info.value
        if not download.suggested_filename.endswith(".mind.json"):
            raise AssertionError(f"Unexpected export filename: {download.suggested_filename}")
        exported = json.loads(Path(download.path()).read_text())
        if exported.get("schemaVersion") != 2 or exported.get("version") != 2:
            raise AssertionError("Mind export did not use schema v2")
        if exported.get("authorProfile", {}).get("displayName") != "Smoke Tester":
            raise AssertionError("Mind export did not include author profile")
        if exported.get("sync", {}).get("provider", None) not in {"", "github"}:
            raise AssertionError("Mind export included invalid sync metadata")
        page.locator("#recoveryButton").click()
        page.wait_for_selector("#recoveryDialog:not([hidden])", timeout=3000)
        if "nodes" not in (page.locator("#recoveryCurrentStats").text_content() or ""):
            raise AssertionError("Recovery current stats did not render")
        page.locator("#recoverySavePointButton").click()
        page.wait_for_timeout(150)
        if page.locator("#recoveryList .recovery-item").count() < 1:
            raise AssertionError("Recovery point did not render")
        page.locator("#recoveryCloseButton").click()
        page.locator("#titleInput").fill("Broken Smoke Root")
        page.wait_for_timeout(150)
        if "Broken Smoke Root" not in (page.locator("#chartCanvas").text_content() or ""):
            raise AssertionError("Recovery setup rename did not render")
        page.locator(".mind-menu > summary").click()
        page.locator("#recoveryButton").click()
        page.wait_for_selector("#recoveryDialog:not([hidden])", timeout=3000)
        page.locator("#recoveryList .recovery-item").first.locator("button", has_text="Restore").click()
        page.wait_for_selector("#appDialog:not([hidden])", timeout=3000)
        if "Restore recovery point" not in (page.locator("#appDialog").text_content() or ""):
            raise AssertionError("Recovery restore did not open app dialog")
        page.locator("#appDialogActions button", has_text="Restore").click()
        page.wait_for_timeout(350)
        if "Modern Smoke Root" not in (page.locator("#chartCanvas").text_content() or ""):
            raise AssertionError("Recovery restore did not restore original title")

        before_maps = page.locator("#mapSelect option").count()
        page.locator("#newMapButton").click()
        page.wait_for_timeout(250)
        after_maps = page.locator("#mapSelect option").count()
        if after_maps != before_maps + 1:
            raise AssertionError(f"New map count mismatch: {before_maps} -> {after_maps}")
        page.locator("#mapSelectDropdown .custom-select-button").click()
        page.wait_for_selector("#mapSelectDropdown .custom-select-list:not([hidden])", timeout=3000)
        if page.locator("#mapSelectDropdown .custom-select-option").count() != after_maps:
            raise AssertionError("Custom map dropdown option count mismatch")
        page.keyboard.press("Escape")

        page.locator(".mind-menu > summary").click()
        page.locator("#deleteMapButton").click()
        page.wait_for_selector("#appDialog:not([hidden])", timeout=3000)
        page.locator("#appDialogActions button", has_text="Delete").click()
        page.wait_for_timeout(250)
        final_maps = page.locator("#mapSelect option").count()
        if final_maps != before_maps:
            raise AssertionError(f"Delete map count mismatch: expected {before_maps}, got {final_maps}")

        page.reload(wait_until="networkidle")
        page.wait_for_selector("#chartCanvas .node", timeout=5000)
        if "Modern Smoke Root" not in (page.locator("#chartCanvas").text_content() or ""):
            raise AssertionError("Saved node missing after reload")

        page.locator("#notesViewButton").evaluate("button => button.click()")
        page.wait_for_selector("#notesDocument:not([hidden])", timeout=3000)
        markdown_doc = (
            "# Imported Smoke Doc\n\n"
            "Root note from pasted markdown.\n\n"
            "## Section One\n\n"
            "Section note body.\n\n"
            "### Action Item\n\n"
            "- Keep bullet text as note content"
        )
        page.locator("#notesRichEditor").evaluate(
            """(editor, text) => {
                editor.focus();
                const data = new DataTransfer();
                data.setData('text/plain', text);
                editor.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
            }""",
            markdown_doc,
        )
        page.locator("#radialViewButton").evaluate("button => button.click()")
        page.wait_for_timeout(250)
        canvas_text = page.locator("#chartCanvas").text_content() or ""
        for expected in ["Imported Smoke Doc", "Section One", "Action Item"]:
            if expected not in canvas_text:
                raise AssertionError(f"Markdown Notes import missing rendered node: {expected}")
        selected_map_label = page.locator("#mapSelect option:checked").text_content() or ""
        if "Imported Smoke Doc" not in selected_map_label:
            raise AssertionError(f"Markdown Notes import did not enter child map: {selected_map_label}")

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
        if page.locator("#welcomeDialog .welcome-logo").count() != 1:
            raise AssertionError("Mobile welcome dialog did not render logo")
        welcome_width = page.locator(".welcome-panel").evaluate("el => el.getBoundingClientRect().width")
        if welcome_width > 390:
            raise AssertionError(f"Mobile welcome panel too wide: {welcome_width}px")
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
