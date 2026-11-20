/**
 * Firebase client: Google Sign-In (Firebase Auth), App Check (reCAPTCHA
 * Enterprise) and Google Analytics for Firebase.
 *
 * Everything is lazy-loaded and a no-op unless VITE_FIREBASE_* is configured,
 * so local/demo use is unchanged. These web config values are public by
 * design (they identify the project; security comes from Auth + App Check +
 * backend token verification) — never put server secrets here.
 */

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

export const firebaseEnabled = Boolean(config.apiKey && config.projectId && config.appId);

let _ready = null;

function init() {
  if (!firebaseEnabled) return Promise.resolve(null);
  if (_ready) return _ready;
  _ready = (async () => {
    const { initializeApp } = await import("firebase/app");
    const { getAuth } = await import("firebase/auth");
    const app = initializeApp(config);
    const services = { app, auth: getAuth(app), appCheck: null, analytics: null };

    const siteKey = import.meta.env.VITE_FIREBASE_APPCHECK_SITE_KEY;
    if (siteKey) {
      try {
        const { initializeAppCheck, ReCaptchaEnterpriseProvider } = await import("firebase/app-check");
        if (import.meta.env.DEV && import.meta.env.VITE_FIREBASE_APPCHECK_DEBUG_TOKEN) {
          self.FIREBASE_APPCHECK_DEBUG_TOKEN = import.meta.env.VITE_FIREBASE_APPCHECK_DEBUG_TOKEN;
        }
        services.appCheck = initializeAppCheck(app, {
          provider: new ReCaptchaEnterpriseProvider(siteKey),
          isTokenAutoRefreshEnabled: true,
        });
      } catch (e) {
        console.warn("[firebase] App Check unavailable", e?.code || e);
      }
    }

    if (config.measurementId && import.meta.env.VITE_FIREBASE_ANALYTICS === "true") {
      try {
        const { getAnalytics, isSupported, setAnalyticsCollectionEnabled } = await import("firebase/analytics");
        if (await isSupported()) {
          services.analytics = getAnalytics(app);
          setAnalyticsCollectionEnabled(services.analytics, true);
        }
      } catch (e) {
        console.warn("[firebase] Analytics unavailable", e?.code || e);
      }
    }
    return services;
  })();
  return _ready;
}

export async function signInWithGoogle() {
  const services = await init();
  if (!services) throw new Error("Google Sign-In isn't configured for this deployment.");
  const { GoogleAuthProvider, signInWithPopup } = await import("firebase/auth");
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  const cred = await signInWithPopup(services.auth, provider);
  trackEvent("login", { method: "google" });
  return cred.user;
}

export async function firebaseSignOut() {
  const services = await init();
  if (!services) return;
  const { signOut } = await import("firebase/auth");
  await signOut(services.auth).catch(() => {});
}

export async function getFirebaseIdToken() {
  const services = await init();
  if (!services) return null;
  await services.auth.authStateReady();
  return services.auth.currentUser ? services.auth.currentUser.getIdToken() : null;
}

export async function getAppCheckHeaders() {
  const services = await init();
  if (!services?.appCheck) return {};
  try {
    const { getToken } = await import("firebase/app-check");
    const { token } = await getToken(services.appCheck, false);
    return token ? { "X-Firebase-AppCheck": token } : {};
  } catch {
    return {};
  }
}

// Only coarse, non-sensitive params ever reach Analytics: names of features,
// counts and durations. Never free text, document contents or health details.
const ALLOWED_PARAMS = new Set(["method", "module", "feature", "count", "duration_minutes", "status", "source"]);

export function trackEvent(name, params = {}) {
  if (!firebaseEnabled) return;
  init().then(async (services) => {
    if (!services?.analytics) return;
    const { logEvent } = await import("firebase/analytics");
    const safe = Object.fromEntries(Object.entries(params).filter(([k, v]) => ALLOWED_PARAMS.has(k) && v != null));
    logEvent(services.analytics, name, safe);
  }).catch(() => {});
}

/** Profile shape matching AuthContext's Supabase profiles; id matches backend auth ("firebase:<uid>"). */
export function buildProfileFromFirebase(fbUser) {
  return {
    id: `firebase:${fbUser.uid}`,
    email: fbUser.email,
    name: fbUser.displayName || fbUser.email?.split("@")[0] || "Friend",
    avatarUrl: fbUser.photoURL || null,
    role: "user",
    abhaId: null,
    disorders: [],
    tagProfile: {},
    enabledModules: [],
    onboardingCompleted: false,
    privacy: { shareActivity: true, shareJournal: false, shareAlerts: true },
    accessibility: { reduceMotion: false, screenReader: false },
    linkedWardIds: [],
    linkedUserId: null,
    _firebase: true,
  };
}
