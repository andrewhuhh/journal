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
    const entryRef = doc(collection(db, ENTRIES_COLLECTION));
    const entryData = {
        userId,
        content: entry.content,
        date: entry.date,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        images: entry.images || []
    };
    
    await setDoc(entryRef, entryData);
    return entryRef.id;
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
    try {
        console.log('Fetching entries for user:', userId, 'since:', lastSync);
        const entriesRef = collection(db, ENTRIES_COLLECTION);
        let q = query(
            entriesRef,
            where('userId', '==', userId),
            orderBy('date', 'desc')  // Changed from updatedAt to date for primary sorting
        );

        // If lastSync provided, add the timestamp filter
        if (lastSync) {
            q = query(
                entriesRef,
                where('userId', '==', userId),
                where('updatedAt', '>', lastSync),
                orderBy('updatedAt', 'desc'),
                orderBy('date', 'desc')
            );
        }
        
        const querySnapshot = await getDocs(q);
        console.log('Retrieved', querySnapshot.size, 'entries from Firestore');
        
        const entries = querySnapshot.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                ...data,
                date: data.date?.toDate() || new Date(), // Handle potential null dates
                createdAt: data.createdAt?.toDate(),
                updatedAt: data.updatedAt?.toDate(),
                images: data.images || [] // Ensure images array exists
            };
        });
        
        console.log('Processed entries:', entries.length);
        return entries;
    } catch (error) {
        console.error('Error fetching user entries:', error);
        throw error; // Re-throw to handle in the UI layer
    }
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