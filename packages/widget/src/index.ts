/**
 * Spec 017 — public exports for the widget package.
 *
 * Two consumer surfaces are exposed:
 *
 *   - `ChatWidget`: the production embed. Bubble + floating panel.
 *     This is what customer firms drop on their websites.
 *
 *   - `ChatPanel`: the panel without the bubble. Pass `mode='embedded'`
 *     to render it inline inside a host's layout (e.g., the dashboard
 *     Preview Chat sidebar). With `mode='floating'` (default) it
 *     behaves as the inner panel of `ChatWidget`.
 *
 * The `PanelShell`, `MessageList`, and `Composer` building blocks
 * remain internal — consumers should compose at the `ChatPanel` level
 * so they pick up SOP, preflight, contact form, and session
 * resumption automatically.
 */

export { ChatWidget } from './components/ChatWidget';
export { ChatPanel } from './components/ChatPanel';
