import { db, storage } from './firebase.js';
import { 
    collection, doc, setDoc, getDoc, getDocs, query, 
    where, orderBy, deleteDoc, updateDoc, serverTimestamp,
    limit, startAfter 
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { currentUser } from './auth.js';

// Collection references
const ENTRIES_COLLECTION = 'entries';
const USERS_COLLECTION = 'users';
const SURVEYS_COLLECTION = 'surveys';

const DEBUG = false;  // Match script.js debug setting

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
 * Gets a user's data from Firestore
 */
export async function getUserData(userId) {
    const userRef = doc(db, USERS_COLLECTION, userId);
    const userDoc = await getDoc(userRef);
    if (userDoc.exists()) {
        return userDoc.data();
    }
    return null;
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
        const data = entrySnap.data();
        const images = data.images || [];
        
        if (images.length > 0) {
            console.log('Processing image deletion for entry:', entryId);
        }
        
        // Delete all images
        await Promise.all(images.map(async (imageUrl) => {
            try {
                // Extract just the path part from the URL
                const urlWithoutParams = imageUrl.split('?')[0];
                const pathParts = urlWithoutParams.split('/o/');
                if (pathParts.length > 1) {
                    const path = decodeURIComponent(pathParts[1]);
                    try {
                        const imageRef = ref(storage, path);
                        await deleteObject(imageRef);
                        console.log('Successfully deleted image:', path);
                    } catch (deleteError) {
                        // Ignore not found errors as the image might have been deleted already
                        if (deleteError.code !== 'storage/object-not-found') {
                            console.error('Failed to delete image:', path, deleteError.message);
                        }
                    }
                }
            } catch (error) {
                // Only log actual errors, not "not found" cases
                if (error.code !== 'storage/object-not-found') {
                    console.error('Error processing image deletion:', error.message);
                }
            }
        }));
        
        // Then delete the entry
        await deleteDoc(entryRef);
        console.log('Successfully deleted entry:', entryId);
    } else {
        console.log('No entry found to delete:', entryId);
    }
}

/**
 * Fetches paginated entries for a user
 */
export async function getUserEntries(userId, options = {}) {
    try {
        const entriesRef = collection(db, ENTRIES_COLLECTION);
        const {
            lastSync = null,
            limit: pageSize = 50,
            startAfter = null,
            startDate = null,
            endDate = null
        } = options;

        let queryConstraints = [
            where('userId', '==', userId)
        ];

        // If we're checking for updates, use updatedAt
        if (lastSync) {
            queryConstraints.push(
                where('updatedAt', '>', lastSync),
                orderBy('updatedAt', 'desc')
            );
        }
        
        // Always add date ordering after any other orderBy constraints
        queryConstraints.push(orderBy('date', 'desc'));

        // Add date range filters if provided
        if (startDate) {
            console.log('Adding startDate constraint:', startDate);
            queryConstraints.push(where('date', '>=', startDate));
        }
        if (endDate) {
            console.log('Adding endDate constraint:', endDate);
            queryConstraints.push(where('date', '<=', endDate));
        }

        // Add pagination cursor if provided
        let q = query(entriesRef, ...queryConstraints);
        if (startAfter && pageSize) {
            q = query(entriesRef, ...queryConstraints, startAfter(startAfter), limit(pageSize));
        } else if (pageSize) {
            q = query(q, limit(pageSize));
        }

        console.log('Executing Firestore query with constraints:', queryConstraints);
        const querySnapshot = await getDocs(q);
        
        const entries = querySnapshot.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                ...data,
                date: data.date?.toDate() || new Date(),
                createdAt: data.createdAt?.toDate(),
                updatedAt: data.updatedAt?.toDate(),
                images: data.images || []
            };
        });

        console.log('Query returned', entries.length, 'entries');

        // Return the last document for pagination
        const lastVisible = querySnapshot.docs[querySnapshot.docs.length - 1];
        
        return {
            entries,
            lastVisible,
            hasMore: querySnapshot.size === pageSize
        };
    } catch (error) {
        console.error('Error fetching user entries:', error);
        throw error;
    }
}

/**
 * Fetches just the dates that have entries for the calendar view
 */
export async function getEntryDates(userId) {
    try {
        const entriesRef = collection(db, ENTRIES_COLLECTION);
        const q = query(
            entriesRef,
            where('userId', '==', userId),
            orderBy('date', 'desc')
        );
        
        const querySnapshot = await getDocs(q);
        const dates = new Set();
        
        querySnapshot.docs.forEach(doc => {
            const data = doc.data();
            if (data.date) {
                const date = data.date.toDate();
                dates.add(date.toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit'
                }));
            }
        });
        
        return Array.from(dates);
    } catch (error) {
        console.error('Error fetching entry dates:', error);
        throw error;
    }
}

/**
 * Uploads an image to Firebase Storage
 */
export async function uploadImage(userId, file, isThumbnail = false) {
    const timestamp = Date.now();
    const folder = isThumbnail ? 'thumbnails' : 'images';
    const path = `users/${userId}/${folder}/${timestamp}_${file.name}`;
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

/**
 * Saves a completed survey to Firestore
 */
export async function saveSurvey(userId, survey) {
    // Check if a survey already exists for this date
    const existingSurvey = await getFirebaseSurveyForDate(userId, survey.metadata.targetDate);
    if (existingSurvey) {
        throw new Error('A survey already exists for this date');
    }

    const surveyRef = doc(collection(db, SURVEYS_COLLECTION));
    const surveyData = {
        userId,
        ...survey,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
    };
    
    await setDoc(surveyRef, surveyData);
    return surveyRef.id;
}

/**
 * Gets all surveys for a user within a date range
 */
export async function getUserSurveys(userId, options = {}) {
    const {
        startDate = null,
        endDate = null,
        limit: pageSize = 50,
        startAfter = null
    } = options;

    const surveysRef = collection(db, SURVEYS_COLLECTION);
    let queryConstraints = [
        where('userId', '==', userId),
        orderBy('metadata.targetDate', 'desc')
    ];

    if (startDate) {
        queryConstraints.push(where('metadata.targetDate', '>=', startDate));
    }
    if (endDate) {
        queryConstraints.push(where('metadata.targetDate', '<=', endDate));
    }

    let q = query(surveysRef, ...queryConstraints);
    if (startAfter && pageSize) {
        q = query(q, startAfter(startAfter), limit(pageSize));
    } else if (pageSize) {
        q = query(q, limit(pageSize));
    }

    const querySnapshot = await getDocs(q);
    const surveys = querySnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
    }));

    return {
        surveys,
        lastVisible: querySnapshot.docs[querySnapshot.docs.length - 1],
        hasMore: querySnapshot.size === pageSize
    };
}

/**
 * Gets a survey for a specific date from Firebase
 */
export async function getFirebaseSurveyForDate(userId, targetDate) {
    const surveysRef = collection(db, SURVEYS_COLLECTION);
    const q = query(
        surveysRef,
        where('userId', '==', userId),
        where('metadata.targetDate', '==', targetDate),
        limit(1)
    );

    const querySnapshot = await getDocs(q);
    if (querySnapshot.empty) {
        return null;
    }

    const doc = querySnapshot.docs[0];
    return {
        id: doc.id,
        ...doc.data()
    };
}

class DatabaseService {
    constructor() {
        this.dbName = 'journalDB';
        this.version = 3;
        this.db = null;
        this.init();
    }

    // Helper method to convert a date to midnight in local timezone
    _getLocalMidnight(date) {
        const localDate = new Date(date);
        localDate.setHours(0, 0, 0, 0);
        return localDate.toISOString();
    }

    async init() {
        if (this.db) return;

        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.version);

            request.onerror = () => {
                console.error('Failed to open database');
                reject(request.error);
            };

            request.onsuccess = (event) => {
                this.db = event.target.result;
                resolve();
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;

                // Create surveys store with date index
                if (!db.objectStoreNames.contains('surveys')) {
                    const surveyStore = db.createObjectStore('surveys', { keyPath: 'id', autoIncrement: true });
                    surveyStore.createIndex('targetDate', 'metadata.targetDate', { unique: false });
                    surveyStore.createIndex('status', 'status', { unique: false });
                }

                // Create drafts store with metadata.targetDate as keyPath
                if (!db.objectStoreNames.contains('drafts')) {
                    const draftStore = db.createObjectStore('drafts', { keyPath: 'data.metadata.targetDate' });
                    draftStore.createIndex('lastUpdated', 'lastUpdated', { unique: false });
                }

                // Create surveys cache store with proper indexes
                if (!db.objectStoreNames.contains('surveysCache')) {
                    const surveysCache = db.createObjectStore('surveysCache', { keyPath: 'metadata.targetDate' });
                    surveysCache.createIndex('lastUpdated', 'lastUpdated', { unique: false });
                    surveysCache.createIndex('userId', 'userId', { unique: false });
                }
            };
        });
    }

    async saveDraft(draft) {
        await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['drafts'], 'readwrite');
            const store = transaction.objectStore('drafts');

            // Ensure the targetDate is set to midnight in local timezone
            const targetDate = this._getLocalMidnight(draft.data.metadata.targetDate);
            
            const draftToSave = {
                ...draft,
                data: {
                    ...draft.data,
                    metadata: {
                        ...draft.data.metadata,
                        targetDate
                    }
                },
                lastUpdated: new Date().toISOString()
            };

            const request = store.put(draftToSave);

            request.onerror = () => {
                console.error('Error saving draft:', request.error);
                reject(request.error);
            };

            request.onsuccess = () => {
                resolve();
            };
        });
    }

    async loadDraft(targetDate) {
        await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['drafts'], 'readonly');
            const store = transaction.objectStore('drafts');

            // Convert targetDate to midnight in local timezone for lookup
            const localTargetDate = this._getLocalMidnight(targetDate);
            const request = store.get(localTargetDate);

            request.onerror = () => {
                console.error('Error loading draft:', request.error);
                reject(request.error);
            };

            request.onsuccess = () => {
                resolve(request.result);
            };
        });
    }

    async deleteDraft(targetDate) {
        await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['drafts'], 'readwrite');
            const store = transaction.objectStore('drafts');

            // Convert targetDate to midnight in local timezone for lookup
            const localTargetDate = this._getLocalMidnight(targetDate);
            const request = store.delete(localTargetDate);

            request.onerror = () => {
                console.error('Error deleting draft:', request.error);
                reject(request.error);
            };

            request.onsuccess = () => {
                resolve();
            };
        });
    }

    async cacheSurvey(survey) {
        await this.init();
        if (DEBUG) console.log('[Survey Cache] Caching survey:', survey);
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['surveysCache'], 'readwrite');
            const store = transaction.objectStore('surveysCache');

            const targetDate = this._getLocalMidnight(survey.metadata.targetDate);
            const surveyToCache = {
                ...survey,
                metadata: {
                    ...survey.metadata,
                    targetDate
                },
                lastUpdated: new Date().toISOString()
            };

            const request = store.put(surveyToCache);

            request.onerror = () => {
                console.error('[Survey Cache] Error caching survey:', request.error);
                reject(request.error);
            };

            request.onsuccess = () => {
                if (DEBUG) console.log('[Survey Cache] Successfully cached survey for date:', targetDate);
                resolve();
            };
        });
    }

    async getCachedSurvey(targetDate) {
        await this.init();
        if (DEBUG) console.log('[Survey Cache] Looking up survey for date:', targetDate);
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['surveysCache'], 'readonly');
            const store = transaction.objectStore('surveysCache');

            const localTargetDate = this._getLocalMidnight(targetDate);
            const request = store.get(localTargetDate);

            request.onerror = () => {
                console.error('[Survey Cache] Error getting cached survey:', request.error);
                reject(request.error);
            };

            request.onsuccess = () => {
                if (DEBUG) {
                    if (request.result) {
                        console.log('[Survey Cache] Found cached survey for date:', localTargetDate);
                    } else {
                        console.log('[Survey Cache] No cached survey found for date:', localTargetDate);
                    }
                }
                resolve(request.result);
            };
        });
    }

    async submitSurvey(data) {
        await this.init();
        return new Promise(async (resolve, reject) => {
            try {
                const transaction = this.db.transaction(['surveys', 'drafts'], 'readwrite');
                const surveyStore = transaction.objectStore('surveys');
                const draftStore = transaction.objectStore('drafts');

                // Ensure the targetDate is set to midnight in local timezone
                const targetDate = this._getLocalMidnight(data.metadata.targetDate);
                const dataToSubmit = {
                    ...data,
                    metadata: {
                        ...data.metadata,
                        targetDate
                    }
                };

                const survey = {
                    data: dataToSubmit,
                    status: 'completed',
                    submittedAt: new Date().toISOString()
                };

                // Save to local IndexedDB
                await new Promise((res, rej) => {
                    const request = surveyStore.add(survey);
                    request.onerror = () => rej(request.error);
                    request.onsuccess = () => res(request.result);
                });

                // Delete the draft
                await new Promise((res, rej) => {
                    const deleteRequest = draftStore.delete(targetDate);
                    deleteRequest.onerror = () => rej(deleteRequest.error);
                    deleteRequest.onsuccess = () => res();
                });

                // If user is logged in, save to Firebase
                if (currentUser?.uid) {
                    const firebaseSurvey = {
                        ...survey,
                        userId: currentUser.uid
                    };
                    await saveSurvey(currentUser.uid, firebaseSurvey);
                }

                resolve();
            } catch (error) {
                console.error('Error in submitSurvey:', error);
                reject(error);
            }
        });
    }

    async getSurveyForDate(targetDate, userId) {
        await this.init();
        
        // Convert targetDate to midnight in local timezone
        const localTargetDate = this._getLocalMidnight(targetDate);
        
        try {
            // First check local IndexedDB cache
            const localSurvey = await this.getCachedSurvey(localTargetDate);
            if (localSurvey) {
                return localSurvey;
            }

            // If not found locally and we have a userId, check Firebase
            if (userId) {
                const firebaseSurvey = await getFirebaseSurveyForDate(userId, localTargetDate);
                if (firebaseSurvey) {
                    // Cache the Firebase result locally
                    await this.cacheSurvey(firebaseSurvey);
                    return firebaseSurvey;
                }
            }

            // Check for local draft as last resort
            const draft = await this.loadDraft(localTargetDate);
            if (draft) {
                return {
                    data: draft.data,
                    status: 'draft',
                    lastUpdated: draft.lastUpdated
                };
            }

            return null;
        } catch (error) {
            console.error('Error in getSurveyForDate:', error);
            throw error;
        }
    }

    async hasSurveyForDate(targetDate) {
        await this.init();
        if (DEBUG) console.log('[Survey Check] Checking for survey on date:', targetDate);
        
        const localTargetDate = this._getLocalMidnight(targetDate);
        
        // First check local cache
        try {
            const transaction = this.db.transaction(['surveysCache'], 'readonly');
            const store = transaction.objectStore('surveysCache');
            const request = store.get(localTargetDate);
            
            const result = await new Promise((resolve, reject) => {
                request.onerror = () => reject(request.error);
                request.onsuccess = () => resolve(request.result != null);
            });
            
            if (result) {
                if (DEBUG) console.log('[Survey Check] Found survey in local cache for date:', localTargetDate);
                return true;
            }
        } catch (error) {
            console.error('[Survey Check] Error checking local cache:', error);
        }
        
        // If not in cache and we have a userId, check Firebase
        if (currentUser?.uid) {
            if (DEBUG) console.log('[Survey Check] Checking Firebase for date:', localTargetDate);
            try {
                const surveysRef = collection(db, SURVEYS_COLLECTION);
                const q = query(
                    surveysRef,
                    where('userId', '==', currentUser.uid),
                    where('metadata.targetDate', '==', localTargetDate),
                    limit(1)
                );
                
                const querySnapshot = await getDocs(q);
                const exists = !querySnapshot.empty;
                
                if (exists) {
                    if (DEBUG) console.log('[Survey Check] Found survey in Firebase for date:', localTargetDate);
                    const survey = {
                        id: querySnapshot.docs[0].id,
                        ...querySnapshot.docs[0].data()
                    };
                    await this.cacheSurvey(survey);
                } else {
                    if (DEBUG) console.log('[Survey Check] No survey found in Firebase for date:', localTargetDate);
                }
                
                return exists;
            } catch (error) {
                console.error('[Survey Check] Error checking Firebase:', error);
                return false;
            }
        }
        
        if (DEBUG) console.log('[Survey Check] No survey found for date:', localTargetDate);
        return false;
    }

    async syncSurveysFromFirebase(userId, options = {}) {
        if (!userId) return;
        
        if (DEBUG) console.log('[Survey Sync] Starting sync for user:', userId, 'with options:', options);
        
        try {
            const { startDate, endDate } = options;
            const { surveys } = await getUserSurveys(userId, { startDate, endDate });
            
            if (DEBUG) console.log('[Survey Sync] Fetched', surveys.length, 'surveys from Firebase');
            
            // Cache all fetched surveys
            for (const survey of surveys) {
                await this.cacheSurvey(survey);
                if (DEBUG) console.log('[Survey Cache] Cached survey for date:', survey.metadata.targetDate);
            }
            
            return surveys;
        } catch (error) {
            console.error('[Survey Sync] Error syncing surveys:', error);
            throw error;
        }
    }

    async cleanupOldDrafts() {
        await this.init();
        if (DEBUG) console.log('[Survey Cleanup] Starting cleanup of old drafts');
        
        return new Promise(async (resolve, reject) => {
            try {
                const transaction = this.db.transaction(['drafts', 'surveysCache'], 'readwrite');
                const draftStore = transaction.objectStore('drafts');
                const surveyStore = transaction.objectStore('surveysCache');
                
                const drafts = await new Promise((res, rej) => {
                    const request = draftStore.getAll();
                    request.onerror = () => rej(request.error);
                    request.onsuccess = () => res(request.result);
                });
                
                if (DEBUG) console.log('[Survey Cleanup] Found', drafts.length, 'drafts to check');
                
                for (const draft of drafts) {
                    const targetDate = draft.data.metadata.targetDate;
                    const survey = await this.getCachedSurvey(targetDate);
                    
                    if (survey && survey.status === 'completed') {
                        if (DEBUG) console.log('[Survey Cleanup] Deleting draft for completed survey date:', targetDate);
                        await new Promise((res, rej) => {
                            const request = draftStore.delete(targetDate);
                            request.onerror = () => rej(request.error);
                            request.onsuccess = () => res();
                        });
                    }
                }
                
                if (DEBUG) console.log('[Survey Cleanup] Cleanup completed');
                resolve();
            } catch (error) {
                console.error('[Survey Cleanup] Error during cleanup:', error);
                reject(error);
            }
        });
    }
}

export const dbService = new DatabaseService(); 