// Tauri uses WebKit on macOS and Linux (WKWebView / WebKitGTK), and WebKit
// fires compositionend BEFORE the keydown that ends an IME composition
// (WebKit bug 165004) -- so the Enter that confirms a Japanese conversion,
// and the Escape that cancels one, both arrive with isComposing already
// false. Both still carry keyCode 229, which no physical key produces, so
// checking both is the only guard that actually works on this app's
// platforms.
export function isImeComposing(e: KeyboardEvent): boolean {
  return e.isComposing || e.keyCode === 229;
}
