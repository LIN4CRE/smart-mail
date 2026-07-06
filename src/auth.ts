import { initializeApp } from "firebase/app";
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, User } from "firebase/auth";
import defaultConfig from "../firebase-applet-config.json";

function getFirebaseConfig() {
  if (
    typeof import.meta !== "undefined" &&
    import.meta.env &&
    import.meta.env.VITE_FIREBASE_API_KEY
  ) {
    return {
      apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
      authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
      projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
      storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
      messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
      appId: import.meta.env.VITE_FIREBASE_APP_ID,
    };
  }
  return defaultConfig;
}

const app = initializeApp(getFirebaseConfig());
const auth = getAuth(app);

const provider = new GoogleAuthProvider();
provider.addScope("https://www.googleapis.com/auth/gmail.modify");
provider.addScope("https://www.googleapis.com/auth/gmail.send");

let cachedAccessToken: string | null = null;

const ACCOUNT_KEY = "smartmail_account";

export const initAuth = (
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: () => void
) => {
  const saved = localStorage.getItem(ACCOUNT_KEY);
  if (saved) {
    try {
      const data = JSON.parse(saved);
      if (data.token && data.expiry > Date.now()) {
        cachedAccessToken = data.token;
      }
    } catch {}
  }

  return onAuthStateChanged(auth, async (user: User | null) => {
    if (user) {
      if (cachedAccessToken) {
        if (onAuthSuccess) onAuthSuccess(user, cachedAccessToken);
      } else {
        if (onAuthFailure) onAuthFailure();
      }
    } else {
      cachedAccessToken = null;
      localStorage.removeItem(ACCOUNT_KEY);
      if (onAuthFailure) onAuthFailure();
    }
  });
};

export const googleSignIn = async (): Promise<{ user: User; accessToken: string } | null> => {
  try {
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error("Failed to get access token from Firebase Auth");
    }

    cachedAccessToken = credential.accessToken;
    localStorage.setItem(
      ACCOUNT_KEY,
      JSON.stringify({ token: cachedAccessToken, expiry: Date.now() + 55 * 60 * 1000 })
    );
    return { user: result.user, accessToken: cachedAccessToken };
  } catch (error: any) {
    if (error?.code === "auth/popup-closed-by-user") {
      return null;
    }
    console.error("Sign in error:", error);
    throw error;
  }
};

export const getAccessToken = async (): Promise<string | null> => {
  return cachedAccessToken;
};

export const logout = async () => {
  await auth.signOut();
  cachedAccessToken = null;
  localStorage.removeItem(ACCOUNT_KEY);
};
