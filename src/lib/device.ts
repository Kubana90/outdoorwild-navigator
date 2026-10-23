// Phone features that only work after a tap (iOS asks for a gesture).

/** iOS 13+: the compass needs explicit permission, asked from a tap handler. */
export async function requestCompassPermission(): Promise<void> {
  const D = DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> }
  if (typeof D.requestPermission !== 'function') return
  try {
    await D.requestPermission()
  } catch {
    // denied: the compass stays off, GPS course is used instead
  }
}

/** iOS only speaks later if speech was started once from a tap. */
export function primeSpeech(): void {
  if (!('speechSynthesis' in window)) return
  const u = new SpeechSynthesisUtterance(' ')
  u.volume = 0
  speechSynthesis.speak(u)
}
