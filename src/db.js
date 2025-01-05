import { db, storage } from './firebase.js';
import { 
    collection, doc, setDoc, getDoc, getDocs, query, 
    where, orderBy, deleteDoc, updateDoc, serverTimestamp 
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';

// Collection references
const ENTRIES_COLLECTION = 'entries';
const USERS_COLLECTION = 'users';

/**
 * Creates or updates a user document in Firestore
 */
export async function saveUserData(userId, userData) {
    const userRef = doc(db, USERS_COLLECTION, userId);
    await setDoc(userRef, {
        ...userData,
        lastUpdated: serverTimestamp()
    }, { merge: true });
}

/**
 * Saves a journal entry to Firestore
 */
export async function saveEntry(userId, entry) {
    try {
        const entryRef = doc(collection(db, ENTRIES_COLLECTION));
        const entryData = {
            userId,
            content: entry.content,
            date: entry.date,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            images: entry.images || [],
            lastModified: serverTimestamp()
        };
        
        await setDoc(entryRef, entryData);
        return entryRef.id;
    } catch (error) {
        if (error.code === 'failed-precondition' || error.message?.includes('ERR_BLOCKED_BY_CLIENT')) {
            console.error('Firestore connection blocked. This may be caused by an ad blocker or privacy extension.');
            throw new Error('Database connection blocked. Please disable ad blocker for this site to enable syncing.');
        }
        throw error;
    }
}

/**
 * Updates an existing journal entry
 */
export async function updateEntry(entryId, updates) {
    const entryRef = doc(db, ENTRIES_COLLECTION, entryId);
    await updateDoc(entryRef, {
        ...updates,
        updatedAt: serverTimestamp()
    });
}

/**
 * Deletes a journal entry and its associated images
 */
export async function deleteEntry(entryId) {
    const entryRef = doc(db, ENTRIES_COLLECTION, entryId);
    const entrySnap = await getDoc(entryRef);
    
    if (entrySnap.exists()) {
        // Delete associated images first
        const images = entrySnap.data().images || [];
        await Promise.all(images.map(async (imageUrl) => {
            const imageRef = ref(storage, imageUrl);
            try {
                await deleteObject(imageRef);
            } catch (error) {
                console.error('Error deleting image:', error);
            }
        }));
        
        // Then delete the entry
        await deleteDoc(entryRef);
    }
}

/**
 * Fetches all entries for a user, sorted by date
 * @param {string} userId - The user's ID
 * @param {Date} [lastSync] - Optional timestamp to fetch only entries modified since then
 */
export async function getUserEntries(userId, lastSync = null) {
    const entriesRef = collection(db, ENTRIES_COLLECTION);
    let q = query(
        entriesRef,
        where('userId', '==', userId),
        orderBy('updatedAt', 'desc')
    );

    // If lastSync provided, only get entries updated since then
    if (lastSync) {
        q = query(
            entriesRef,
            where('userId', '==', userId),
            where('updatedAt', '>', lastSync),
            orderBy('updatedAt', 'desc')
        );
    }
    
    const querySnapshot = await getDocs(q);
    return querySnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        date: doc.data().date.toDate(), // Convert Firestore Timestamp to JS Date
        createdAt: doc.data().createdAt?.toDate(),
        updatedAt: doc.data().updatedAt?.toDate()
    }));
}

/**
 * Uploads an image to Firebase Storage
 */
export async function uploadImage(userId, file) {
    const timestamp = Date.now();
    const path = `users/${userId}/images/${timestamp}_${file.name}`;
    const imageRef = ref(storage, path);
    
    await uploadBytes(imageRef, file);
    const downloadUrl = await getDownloadURL(imageRef);
    
    return {
        url: downloadUrl,
        path: path
    };
}

/**
 * Deletes an image from Firebase Storage
 */
export async function deleteImage(imagePath) {
    const imageRef = ref(storage, imagePath);
    await deleteObject(imageRef);
}

export async function fetchAndMergeUpdates(lastSyncTime) {
    try {
        const q = query(collection(db, 'entries'), 
            where('lastModified', '>', lastSyncTime));
        const querySnapshot = await getDocs(q);
        
        if (!querySnapshot) {
            throw new Error('Failed to fetch updates from Firestore');
        }

        return querySnapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));
    } catch (error) {
        if (error.code === 'failed-precondition' || error.message?.includes('ERR_BLOCKED_BY_CLIENT')) {
            console.error('Firestore connection blocked. This may be caused by an ad blocker or privacy extension.');
            throw new Error('Database connection blocked. Please disable ad blocker for this site to enable syncing.');
        }
        throw error;
    }
} 