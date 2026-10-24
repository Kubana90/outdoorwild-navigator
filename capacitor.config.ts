import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'de.outdoorwild.navigator',
  appName: 'OutdoorWild',
  webDir: 'dist',
  android: {
    // tiles and APIs are all https; keep the WebView strict
    allowMixedContent: false,
    // without it, background location stops after ~5 min (background-geolocation #89)
    useLegacyBridge: true,
  },
  plugins: {
    LocalNotifications: { iconColor: '#2e7d32' },
  },
}

export default config
