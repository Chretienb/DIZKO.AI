package ai.dizko.app;

import android.graphics.Color;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  // Android's WebView clear-colors to black by default, which flashes
  // through during rubber-band/overscroll before CSS repaints (reported
  // live as "black screen when I scroll"). capacitor.config.ts's
  // backgroundColor covers the splash screen; the WebView itself needs
  // this explicitly.
  @Override
  public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    getBridge().getWebView().setBackgroundColor(Color.parseColor("#0A0A0C"));
  }
}
