import { initializeApp } from 'firebase/app';
import { getAuth, signInWithPopup, GoogleAuthProvider, signOut } from 'firebase/auth';

const firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
    measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();

let signInInProgress = false;
export let currentUser = null;

export async function signInWithGoogle() {
    if (signInInProgress) {
        console.log('Sign-in already in progress');
        return;
    }

    try {
        signInInProgress = true;
        const result = await signInWithPopup(auth, provider);
        return result.user;
    } catch (error) {
        if (error.code === 'auth/popup-closed-by-user' || error.code === 'auth/cancelled-popup-request') {
            console.log('Sign-in popup was closed by the user');
        } else {
            console.error('Error signing in with Google:', error);
        }
        throw error;
    } finally {
        signInInProgress = false;
    }
}

export async function signOutUser() {
    try {
        await signOut(auth);
    } catch (error) {
        console.error('Error signing out:', error);
        throw error;
    }
}

export function onAuthChange(callback) {
    return auth.onAuthStateChanged((user) => {
        currentUser = user;
        callback(user);
    });
} 