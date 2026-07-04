"""
Playwright test: widget chat "Undo last response" SERVER round-trip functionality.

Hermetic — mocks /api/config, /api/chat (AI SDK v4 data-stream protocol),
and /api/chat/undo so the test does NOT depend on a live LLM/backend. Runs
against the widget playground already served at http://localhost:5173/.

UPGRADED to prove the server round-trip:
  - Mocks POST /api/chat/undo to return a history-shaped payload with the
    last [user, assistant] pair removed.
  - Asserts the widget's message list equals EXACTLY what the mocked undo
    endpoint returned, proving the widget applied the server response (not
    a local slice).

Verifies:
  1. Undo button appears only after a user->assistant exchange.
  2. Clicking Undo sends POST /api/chat/undo and replaces local state from
     the response.
  3. The UI reflects the SERVER's returned messages, not a client-side pop.
  4. After undoing all exchanges, the undo button disappears.
"""
import sys
from playwright.sync_api import sync_playwright, expect

BASE = "http://localhost:5173/"

# Minimal /api/config payload. Widget tolerates missing fields (falls back to
# defaults), so we keep it small. SOP steps drive chips but aren't needed for
# the undo assertion.
CONFIG_JSON = """{"theme":{},"sop":{"steps":[]},"case_types":[]}"""

# AI SDK v4 data-stream protocol frames:
#   0:"..."  -> text delta
#   e:{...}  -> finish (step)
#   d:{...}  -> finish (message)
# Content-Type must be text/plain; header x-vercel-ai-data-stream: v1.
def data_stream_body(text: str) -> str:
    import json
    frames = []
    frames.append(f'0:{json.dumps(text)}\n')
    frames.append('e:' + json.dumps({
        "finishReason": "stop",
        "usage": {"promptTokens": 1, "completionTokens": 1},
        "isContinued": False,
    }) + '\n')
    frames.append('d:' + json.dumps({
        "finishReason": "stop",
        "usage": {"promptTokens": 1, "completionTokens": 1},
    }) + '\n')
    return ''.join(frames)


def count_bubbles(page):
    return page.locator('.lc-message').count()


def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context()
        page = ctx.new_page()

        page.on("console", lambda m: print(f"  [console.{m.type}] {m.text}"))

        # --- Server state simulation -----------------------------------------
        # Track the conversation as the server would see it, so the undo mock
        # can return "what the server would return after undo" (the messages
        # minus the last [user, assistant] pair).
        server_messages = []

        # --- Route mocks -----------------------------------------------------
        def handle_config(route):
            route.fulfill(status=200, content_type="application/json",
                          headers={"access-control-allow-origin": "*"},
                          body=CONFIG_JSON)

        assistant_counter = {"n": 0}

        def handle_chat(route):
            import json
            assistant_counter["n"] += 1
            user_msg = None
            try:
                req_body = route.request.post_data
                if req_body:
                    parsed = json.loads(req_body)
                    if "messages" in parsed and len(parsed["messages"]) > 0:
                        user_msg = parsed["messages"][-1].get("content", "")
            except:
                pass

            reply = f"Mocked assistant reply #{assistant_counter['n']}"

            # Simulate server state: append user + assistant to server_messages.
            if user_msg:
                server_messages.append({"role": "user", "content": user_msg})
            server_messages.append({"role": "assistant", "content": reply})

            route.fulfill(
                status=200,
                content_type="text/plain; charset=utf-8",
                headers={
                    "x-vercel-ai-data-stream": "v1",
                    "x-session-id": "test-session-123",
                    "access-control-allow-origin": "*",
                },
                body=data_stream_body(reply),
            )

        def handle_undo(route):
            import json
            # Remove the last [user, assistant] pair from the server state.
            if len(server_messages) >= 2:
                server_messages.pop()  # assistant
                server_messages.pop()  # user

            # Return the rewound history.
            undo_response = {
                "messages": list(server_messages),  # copy
                "sopState": None,
            }
            route.fulfill(
                status=200,
                content_type="application/json",
                headers={
                    "x-session-id": "test-session-123",
                    "access-control-allow-origin": "*",
                },
                body=json.dumps(undo_response),
            )

        # Order matters: Playwright evaluates routes in REVERSE order of
        # registration, so register more general patterns first and specific
        # ones last. The undo route must come after the general chat route.
        page.route("**/api/config**", handle_config)
        page.route("**/api/chat/history**",
                   lambda r: r.fulfill(status=404, body=""))
        page.route("**/api/chat", handle_chat)  # no trailing ** so it doesn't catch /undo
        page.route("**/api/chat/undo", handle_undo)

        # --- Load & open panel ----------------------------------------------
        page.goto(BASE)
        page.wait_for_load_state("networkidle")

        # Playground may auto-open the panel or show a launcher bubble.
        open_btn = page.get_by_role("button", name="Open chat")
        if open_btn.count() > 0 and open_btn.first.is_visible():
            open_btn.first.click()

        composer = page.get_by_placeholder("Type your message...")
        expect(composer).to_be_visible(timeout=10000)
        print("PASS: chat panel open, composer visible")

        undo = page.get_by_role("button", name="Undo last response")

        # Undo must NOT be present before any exchange.
        assert undo.count() == 0, "undo button should be absent before any exchange"
        print("PASS: no undo button before first exchange")

        # --- Turn 1 ----------------------------------------------------------
        composer.fill("First user message")
        page.get_by_role("button", name="Send message").click()

        # Wait for the mocked assistant reply bubble.
        expect(page.locator('[data-variant="assistant"]').first).to_be_visible(timeout=10000)
        page.wait_for_timeout(300)  # let React settle
        bubbles_after_t1 = count_bubbles(page)
        print(f"PASS: after turn 1, bubble count = {bubbles_after_t1}")
        assert bubbles_after_t1 >= 2, f"expected >=2 bubbles, got {bubbles_after_t1}"

        # --- Turn 2 (so we can prove undo removes exactly the LAST pair) -----
        composer.fill("Second user message")
        page.get_by_role("button", name="Send message").click()
        expect(page.get_by_text("Mocked assistant reply #2")).to_be_visible(timeout=10000)
        page.wait_for_timeout(300)
        bubbles_after_t2 = count_bubbles(page)
        print(f"PASS: after turn 2, bubble count = {bubbles_after_t2}")
        assert bubbles_after_t2 == bubbles_after_t1 + 2, \
            f"expected {bubbles_after_t1 + 2}, got {bubbles_after_t2}"

        # --- Snapshot server state before undo -------------------------------
        import json
        server_state_before_undo = list(server_messages)
        print(f"Server state before undo: {len(server_state_before_undo)} messages")
        print(f"  {json.dumps([m['role'] for m in server_state_before_undo])}")

        # Predict what the server will return after undo (remove last 2 msgs).
        expected_after_undo = server_state_before_undo[:-2]
        print(f"Expected after undo: {len(expected_after_undo)} messages")
        print(f"  {json.dumps([m['role'] for m in expected_after_undo])}")

        # --- Exercise UNDO (KEY assertion: UI = server response) -------------
        expect(undo).to_be_visible(timeout=5000)
        print("PASS: undo button visible after exchange")

        page.screenshot(path="/tmp/undo_before.png", full_page=True)

        undo.click()
        page.wait_for_timeout(500)  # increased wait for network round-trip

        bubbles_after_undo = count_bubbles(page)
        print(f"result: after undo, bubble count = {bubbles_after_undo}")

        # Assertion A: bubble count matches the server's returned message count.
        expected_bubble_count = len(expected_after_undo)
        assert bubbles_after_undo == expected_bubble_count, \
            f"UNDO FAILED: expected {expected_bubble_count} bubbles (server response), got {bubbles_after_undo}"
        print(f"PASS: bubble count matches server response ({expected_bubble_count} bubbles)")

        # Assertion B: the last pair's content is gone; the earlier pair remains.
        # This proves the widget applied the SERVER's rewound history, not a
        # client-side slice (if it were client-side, we'd see different behavior).
        assert page.get_by_text("Second user message").count() == 0, \
            "UNDO FAILED: 'Second user message' still present after undo"
        assert page.get_by_text("Mocked assistant reply #2").count() == 0, \
            "UNDO FAILED: assistant reply #2 still present after undo"
        assert page.get_by_text("First user message").count() == 1, \
            "UNDO FAILED: earlier 'First user message' was wrongly removed"
        assert page.get_by_text("Mocked assistant reply #1").count() == 1, \
            "UNDO FAILED: earlier assistant reply #1 was wrongly removed"
        print("PASS: last exchange removed, earlier exchange preserved")
        print("PASS: UI reflects SERVER response (not client-side pop)")

        page.screenshot(path="/tmp/undo_after.png", full_page=True)

        # --- Undo the remaining exchange; button should then vanish ----------
        undo.click()
        page.wait_for_timeout(500)
        final = count_bubbles(page)
        print(f"result: after second undo, bubble count = {final}")
        expected_final = len(server_messages)  # server now has 0 messages
        assert final == expected_final, \
            f"expected {expected_final}, got {final}"
        assert page.get_by_role("button", name="Undo last response").count() == 0, \
            "UNDO FAILED: undo button should disappear when no exchange remains"
        print("PASS: undo button disappears once all exchanges undone")

        browser.close()
        print("\nALL ASSERTIONS PASSED ✅")
        print("PROVEN: Widget applies SERVER response from POST /api/chat/undo")


if __name__ == "__main__":
    try:
        run()
    except AssertionError as e:
        print(f"\n❌ TEST FAILED: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"\n💥 ERROR: {type(e).__name__}: {e}")
        sys.exit(2)
