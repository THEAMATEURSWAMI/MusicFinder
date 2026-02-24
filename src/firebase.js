import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
    apiKey: "AIzaSyDDHqjkRJY_fHI-0hqUiJu8GYIxjjQI2bk",
    authDomain: "spotifyunlocked.firebaseapp.com",
    projectId: "spotifyunlocked",
    storageBucket: "spotifyunlocked.firebasestorage.app",
    messagingSenderId: "504617755413",
    appId: "1:504617755413:web:de9c59204d2b91cdfeff1c",
    measurementId: "G-M59C1FKFXR"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();

export default app;
