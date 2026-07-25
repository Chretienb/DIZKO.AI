import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'ai.dizko.app',
  appName: 'Dizko',
  webDir: 'dist',
  // Both native WebViews default to a black clear color, which flashes through
  // during rubber-band/overscroll before the CSS layer repaints (reported live
  // as "black screen when I scroll"). Match --outer so the bounce reads as the
  // app's own background instead of a glitch.
  backgroundColor: '#0A0A0C',
  server: {
    // Local Vite dev server for testing in-progress mobile changes (hot
    // reload). Revert to 'https://app.dizko.ai' before shipping.
    url: 'http://192.168.1.186:5173',
    cleartext: true
  }
};

export default config;
