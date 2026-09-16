import { initializeApp } from "firebase/app";
import { getFirestore, doc, setDoc, increment } from "firebase/firestore";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "voce-desktop.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "voce-desktop",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "voce-desktop.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "",
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || ""
};

// Graceful initialization if Firebase API key is configured
const app = firebaseConfig.apiKey ? initializeApp(firebaseConfig) : null;
export const db = app ? getFirestore(app) : null;

const ANONYMOUS_CLIENT_ID_KEY = "voce_anonymous_client_id";
const INSTALL_REPORTED_KEY = "voce_install_reported";

/**
 * Ensures an anonymous, non-identifiable client UUID is initialized in local storage.
 * Never links or shares personal user information.
 */
export function getAnonymousClientId(): string {
  let clientId = localStorage.getItem(ANONYMOUS_CLIENT_ID_KEY);
  if (!clientId) {
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
      clientId = crypto.randomUUID();
    } else {
      clientId = "anon_" + Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
    }
    localStorage.setItem(ANONYMOUS_CLIENT_ID_KEY, clientId);
  }
  return clientId;
}

/**
 * Atomically increments the total_users counter on metrics/global on first launch.
 */
export async function reportAppInstall(): Promise<void> {
  if (!db) return;
  try {
    const isReported = localStorage.getItem(INSTALL_REPORTED_KEY);
    if (!isReported) {
      getAnonymousClientId(); // Ensure anonymous UUID exists
      const globalDocRef = doc(db, "metrics", "global");
      await setDoc(globalDocRef, { total_users: increment(1) }, { merge: true });
      localStorage.setItem(INSTALL_REPORTED_KEY, "true");
      console.log("[Firebase Telemetry] Anonymous install metric recorded.");
    }
  } catch (error) {
    console.warn("[Firebase Telemetry] Failed to report install metric:", error);
  }
}

/**
 * Atomically increments the total_words_dictated counter on metrics/global upon successful Groq STT dictation.
 * Strictly anonymous - no user info or text is ever sent.
 */
export async function reportSttDictation(wordCount: number): Promise<void> {
  if (!db || wordCount <= 0) return;
  try {
    const globalDocRef = doc(db, "metrics", "global");
    await setDoc(globalDocRef, { total_words_dictated: increment(wordCount) }, { merge: true });
    console.log(`[Firebase Telemetry] Incremented total_words_dictated by ${wordCount}.`);
  } catch (error) {
    console.warn("[Firebase Telemetry] Failed to report STT metric:", error);
  }
}

/**
 * Atomically increments the total_chars_translated counter on metrics/global upon successful Groq translation.
 * Strictly anonymous - no user info or text is ever sent.
 */
export async function reportTranslation(charCount: number): Promise<void> {
  if (!db || charCount <= 0) return;
  try {
    const globalDocRef = doc(db, "metrics", "global");
    await setDoc(globalDocRef, { total_chars_translated: increment(charCount) }, { merge: true });
    console.log(`[Firebase Telemetry] Incremented total_chars_translated by ${charCount}.`);
  } catch (error) {
    console.warn("[Firebase Telemetry] Failed to report translation metric:", error);
  }
}
