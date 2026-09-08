import os
from pathlib import Path

from playwright.sync_api import sync_playwright


OUTPUT = Path("/tmp/lcoder-browser-smoke.png")
COMPACT_OUTPUT = Path("/tmp/lcoder-browser-smoke-compact.png")
SMOKE_URL = os.environ.get("LCODER_SMOKE_URL", "http://127.0.0.1:1420")
CHROME = Path(
    os.environ.get(
        "LCODER_CHROME",
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    )
)


with sync_playwright() as playwright:
    launch_options = {"headless": True}
    if CHROME.is_file():
        launch_options["executable_path"] = str(CHROME)
    browser = playwright.chromium.launch(**launch_options)
    page = browser.new_page(viewport={"width": 1440, "height": 900}, device_scale_factor=1)
    errors: list[str] = []
    page.on("console", lambda message: errors.append(message.text) if message.type == "error" else None)
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(SMOKE_URL)
    page.wait_for_load_state("networkidle")
    page.evaluate("localStorage.setItem('lcoder.theme.v2', 'light')")
    page.reload()
    page.wait_for_load_state("networkidle")

    page.get_by_role("treeitem", name="src").click()
    page.wait_for_timeout(150)
    page.get_by_role("treeitem", name="lib.rs").click()
    page.wait_for_selector(".monaco-editor")
    browse_current = page.locator(".tree-row.current-file", has_text="lib.rs")
    assert browse_current.is_visible()
    assert browse_current.get_attribute("aria-current") == "page"
    navigator_width = page.locator(".left-panel").bounding_box()["width"]
    navigator_resizer = page.get_by_role("separator", name="Resize navigator")
    navigator_resizer_box = navigator_resizer.bounding_box()
    navigator_resizer.hover()
    page.mouse.down()
    page.mouse.move(
        navigator_resizer_box["x"] + 70,
        navigator_resizer_box["y"] + navigator_resizer_box["height"] / 2,
        steps=6,
    )
    page.mouse.up()
    page.wait_for_timeout(100)
    resized_navigator_width = page.locator(".left-panel").bounding_box()["width"]
    assert resized_navigator_width > navigator_width + 50
    assert float(page.evaluate("localStorage.getItem('lcoder.left-width')")) == resized_navigator_width

    editor = page.locator(".monaco-editor")
    editor.click(position={"x": 150, "y": 90})
    page.mouse.click(
        editor.bounding_box()["x"] + 150,
        editor.bounding_box()["y"] + 90,
        button="right",
    )
    page.get_by_role("menuitem", name="AI: Explain Entire File").click()
    page.get_by_role("dialog").wait_for()
    page.get_by_role("button", name="Trust & continue").click()
    page.get_by_text("RUNNING").wait_for()
    page.get_by_text("Sent", exact=False).wait_for()
    page.get_by_text("Entire file", exact=True).wait_for()
    assert page.locator(".terminal-pane").evaluate(
        "(element) => getComputedStyle(element).backgroundColor"
    ) == "rgb(255, 255, 255)"
    assert page.locator(".terminal-viewport").evaluate(
        "(element) => getComputedStyle(element).backgroundColor"
    ) == "rgb(255, 255, 255)"

    page.locator(".monaco-editor").click(position={"x": 150, "y": 90})
    page.keyboard.press("ControlOrMeta+A")
    page.get_by_role("button", name="Explain selection").click()
    page.get_by_text("L1–L6", exact=True).wait_for()

    page.get_by_role("button", name="Review").click()
    page.get_by_role("treeitem", name="lexer.rs").click()
    page.wait_for_selector(".monaco-diff-editor")
    working_current = page.locator(".tree-row.current-file", has_text="lexer.rs")
    assert working_current.is_visible()

    page.get_by_role("button", name="History").click()
    page.locator(".commit-list").wait_for()
    history_height = page.locator(".commit-list").bounding_box()["height"]
    history_resizer = page.get_by_role("separator", name="Resize commit history")
    history_resizer_box = history_resizer.bounding_box()
    history_resizer.hover()
    page.mouse.down()
    page.mouse.move(
        history_resizer_box["x"] + history_resizer_box["width"] / 2,
        history_resizer_box["y"] + 70,
        steps=6,
    )
    page.mouse.up()
    page.wait_for_timeout(100)
    resized_history_height = page.locator(".commit-list").bounding_box()["height"]
    assert resized_history_height > history_height + 50
    assert (
        float(page.evaluate("localStorage.getItem('lcoder.history-height')"))
        == resized_history_height
    )
    page.get_by_role("treeitem", name="lexer.rs").click()
    page.wait_for_timeout(100)
    history_current = page.locator(".tree-row.current-file", has_text="lexer.rs")
    assert history_current.is_visible()
    assert history_current.get_attribute("aria-current") == "page"

    terminal_width = page.locator(".right-panel").bounding_box()["width"]
    terminal_resizer = page.get_by_role("separator", name="Resize terminal")
    terminal_resizer_box = terminal_resizer.bounding_box()
    terminal_resizer.hover()
    page.mouse.down()
    page.mouse.move(
        terminal_resizer_box["x"] - 60,
        terminal_resizer_box["y"] + terminal_resizer_box["height"] / 2,
        steps=6,
    )
    page.mouse.up()
    page.wait_for_timeout(100)
    resized_terminal_width = page.locator(".right-panel").bounding_box()["width"]
    assert resized_terminal_width > terminal_width + 45
    assert float(page.evaluate("localStorage.getItem('lcoder.right-width')")) == resized_terminal_width

    page.get_by_role("button", name="Toggle theme").click()
    page.wait_for_timeout(100)
    assert page.locator(".terminal-pane").evaluate(
        "(element) => getComputedStyle(element).backgroundColor"
    ) == "rgb(34, 35, 38)"
    assert page.locator(".terminal-viewport").evaluate(
        "(element) => getComputedStyle(element).backgroundColor"
    ) == "rgb(34, 35, 38)"
    page.get_by_role("button", name="Toggle theme").click()

    page.screenshot(path=str(OUTPUT), full_page=True)
    assert page.get_by_text("LCoder").first.is_visible()
    assert page.get_by_text("parent → commit").is_visible()

    page.set_viewport_size({"width": 960, "height": 760})
    page.locator(".right-panel.compact-open").wait_for()
    page.screenshot(path=str(COMPACT_OUTPUT), full_page=True)
    assert page.locator(".right-panel.compact-open").is_visible()
    assert not errors, f"Browser errors: {errors}"
    browser.close()

print(OUTPUT)
print(COMPACT_OUTPUT)
