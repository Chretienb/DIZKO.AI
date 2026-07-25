import UIKit
import Capacitor

// The viewport meta tag (maximum-scale=1.0, user-scalable=no) isn't always
// enough on its own to stop pinch-zoom inside a WKWebView — reported live as
// "why does it zoom in? it should not, it is a mobile app". Disabling the
// webview's own pinch gesture recognizer is the reliable fix.
class MainViewController: CAPBridgeViewController {
    override func viewDidLoad() {
        super.viewDidLoad()
        webView?.scrollView.pinchGestureRecognizer?.isEnabled = false
    }
}
