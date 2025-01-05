import { signInWithGoogle, signOutUser, onAuthChange } from './auth.js';
import { 
    saveUserData, 
    saveEntry as saveEntryToDb, 
    updateEntry, 
    deleteEntry as deleteEntryFromDb, 
    getUserEntries,
    uploadImage,
    deleteImage 
} from './db.js';
import { TIME_GRADIENTS } from './gradients.js';

// Add IndexedDB setup
const DB_NAME = 'journalCache';
const DB_VERSION = 1;
const ENTRIES_STORE = 'entries';
const METADATA_STORE = 'metadata';

// Add after IndexedDB setup constants
const DEBUG = true;
const CACHE_CONFIG = {
    maxAge: 24 * 60 * 60 * 1000, // Increase to 24 hours for better persistence
    staleWhileRevalidate: true
};

// Add after IndexedDB setup constants
const LOADING_STATES = {
    profile: false,
    entries: false
};

let lastGradientUpdate = 0;
const GRADIENT_UPDATE_INTERVAL = 10 * 60 * 1000; // 10 minutes

// Add after IndexedDB setup constants
const MONTHS = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
];

// Add after IndexedDB setup constants
const DISPLAY_CONFIG = {
    currentWeekOffset: 0, // 0 = current week, 1 = last week, etc.
    sidebarPreviewItems: 10
};

function updateTimeBasedGradient() {
    const now = new Date();
    
    // Only update if enough time has passed
    if (now.getTime() - lastGradientUpdate < GRADIENT_UPDATE_INTERVAL) {
        return;
    }
    
    lastGradientUpdate = now.getTime();
    const hour = now.getHours();
    
    // Find the current time period
    let currentPeriod = null;
    for (const [period, config] of Object.entries(TIME_GRADIENTS)) {
        const start = config.start;
        const end = config.end;
        
        if (end > start) {
            // Normal time range (e.g., 7 AM to 11 AM)
            if (hour >= start && hour < end) {
                currentPeriod = period;
                break;
            }
        } else {
            // Overnight time range (e.g., 10 PM to 3 AM)
            if (hour >= start || hour < end) {
                currentPeriod = period;
                break;
            }
        }
    }
    
    if (!currentPeriod) {
        currentPeriod = 'noon'; // Default fallback
    }
    
    const gradient = TIME_GRADIENTS[currentPeriod];
    const colors = gradient.colors;
    
    // Convert hex colors to rgba with 0.2 opacity
    const convertHexToRgba = (hex) => {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return `rgba(${r}, ${g}, ${b}, 0.2)`;
    };
    
    // Create gradient stops based on number of colors
    const gradientStops = colors.map((color, index) => {
        const percentage = (index / (colors.length - 1)) * 100;
        return `${convertHexToRgba(color)} ${percentage}%`;
    }).join(', ');
    
    // Apply the gradient to body::before using a CSS custom property
    document.documentElement.style.setProperty(
        '--current-gradient',
        `linear-gradient(to bottom, ${gradientStops})`
    );
    
    if (DEBUG) {
        log(`Applied ${currentPeriod} gradient`);
    }
}

function log(...args) {
    if (DEBUG) {
        console.log('%c[Journal Debug]', 'color: #4CAF50; font-weight: bold;', ...args);
    }
}

function logPerformance(operation, startTime) {
    if (DEBUG) {
        const duration = performance.now() - startTime;
        console.log(
            '%c[Journal Performance]',
            'color: #2196F3; font-weight: bold;',
            `${operation}: ${duration.toFixed(2)}ms`
        );
    }
}

// Initialize IndexedDB
async function initializeDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = () => {
            log('Error opening IndexedDB:', request.error);
            reject(request.error);
        };
        
        request.onsuccess = () => {
            log('Successfully opened IndexedDB');
            resolve(request.result);
        };

        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            log('Upgrading IndexedDB schema');
            
            // Create entries store with index on userId
            if (!db.objectStoreNames.contains(ENTRIES_STORE)) {
                const entriesStore = db.createObjectStore(ENTRIES_STORE, { keyPath: 'id' });
                entriesStore.createIndex('userId', 'userId', { unique: false });
                entriesStore.createIndex('date', 'date', { unique: false });
                log('Created entries store');
            }

            // Create metadata store for last sync time
            if (!db.objectStoreNames.contains(METADATA_STORE)) {
                const metadataStore = db.createObjectStore(METADATA_STORE, { keyPath: 'key' });
                log('Created metadata store');
            }
        };
    });
}

// Cache operations
async function getFromCache(userId) {
    const startTime = performance.now();
    log('Attempting to load from cache for user:', userId);
    
    try {
        const db = await initializeDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([ENTRIES_STORE, METADATA_STORE], 'readonly');
            const store = transaction.objectStore(ENTRIES_STORE);
            const metadataStore = transaction.objectStore(METADATA_STORE);
            const index = store.index('userId');

            // Get last sync time first
            const syncRequest = metadataStore.get(`lastSync_${userId}`);
            syncRequest.onsuccess = () => {
                const lastSync = syncRequest.result?.timestamp;
                const now = Date.now();
                const isCacheValid = lastSync && (now - new Date(lastSync).getTime()) < CACHE_CONFIG.maxAge;

                if (!isCacheValid && !CACHE_CONFIG.staleWhileRevalidate) {
                    log('Cache expired and staleWhileRevalidate disabled');
                    resolve({ entries: [], isStale: true });
                    return;
                }

                const request = index.getAll(userId);
                request.onerror = () => {
                    log('Cache read error:', request.error);
                    reject(request.error);
                };
                
                request.onsuccess = () => {
                    const entries = request.result.map(entry => ({
                        ...entry,
                        date: new Date(entry.date)
                    }));
                    logPerformance('Cache Read', startTime);
                    log(`Found ${entries.length} entries in cache${!isCacheValid ? ' (stale)' : ''}`);
                    resolve({ entries, isStale: !isCacheValid });
                };
            };

            syncRequest.onerror = () => {
                log('Error getting last sync time:', syncRequest.error);
                reject(syncRequest.error);
            };
        });
    } catch (error) {
        log('Error accessing cache:', error);
        return { entries: [], isStale: true };
    }
}

async function updateCache(userId, entries) {
    const startTime = performance.now();
    log('Updating cache for user:', userId, 'with', entries.length, 'entries');
    
    const db = await initializeDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([ENTRIES_STORE, METADATA_STORE], 'readwrite');
        const store = transaction.objectStore(ENTRIES_STORE);
        const metadataStore = transaction.objectStore(METADATA_STORE);

        // Clear existing entries for this user
        const clearRequest = store.index('userId').openKeyCursor(userId);
        clearRequest.onsuccess = (event) => {
            const cursor = event.target.result;
            if (cursor) {
                store.delete(cursor.primaryKey);
                cursor.continue();
            }
        };

        // Add new entries
        entries.forEach(entry => {
            store.put({
                ...entry,
                userId,
                date: entry.date.toISOString()
            });
        });

        // Update last sync time
        const syncTime = new Date().toISOString();
        metadataStore.put({
            key: `lastSync_${userId}`,
            timestamp: syncTime
        });

        transaction.oncomplete = () => {
            logPerformance('Cache Update', startTime);
            log('Cache update complete. Last sync:', syncTime);
            resolve();
        };
        
        transaction.onerror = () => {
            log('Cache update error:', transaction.error);
            reject(transaction.error);
        };
    });
}

async function addToCache(userId, entry) {
    const startTime = performance.now();
    log('Adding new entry to cache for user:', userId);
    
    const db = await initializeDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(ENTRIES_STORE, 'readwrite');
        const store = transaction.objectStore(ENTRIES_STORE);

        const request = store.put({
            ...entry,
            userId,
            date: entry.date.toISOString()
        });

        request.onerror = () => {
            log('Cache add error:', request.error);
            reject(request.error);
        };
        
        request.onsuccess = () => {
            logPerformance('Cache Add', startTime);
            log('Successfully added entry to cache');
            resolve();
        };
    });
}

async function removeFromCache(userId, entryId) {
    const startTime = performance.now();
    log('Removing entry from cache:', entryId);
    
    const db = await initializeDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(ENTRIES_STORE, 'readwrite');
        const store = transaction.objectStore(ENTRIES_STORE);
        const request = store.delete(entryId);

        request.onerror = () => {
            log('Cache remove error:', request.error);
            reject(request.error);
        };
        
        request.onsuccess = () => {
            logPerformance('Cache Remove', startTime);
            log('Successfully removed entry from cache');
            resolve();
        };
    });
}

// Add after cache operations
async function getLastSyncTime(userId) {
    const db = await initializeDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(METADATA_STORE, 'readonly');
        const store = transaction.objectStore(METADATA_STORE);
        const request = store.get(`lastSync_${userId}`);

        request.onerror = () => {
            log('Error getting last sync time:', request.error);
            reject(request.error);
        };
        
        request.onsuccess = () => {
            const result = request.result;
            resolve(result ? new Date(result.timestamp) : null);
        };
    });
}

document.addEventListener('DOMContentLoaded', () => {
    // Auth elements
    const container = document.querySelector('.container');
    const authHeader = document.querySelector('.auth-header');
    const authButton = document.querySelector('.auth-header .auth-button');
    const welcomeAuthButton = document.querySelector('.welcome-auth-button');
    const authMenu = document.querySelector('.auth-menu');
    const authMenuUser = document.querySelector('.auth-menu-user');
    const authMenuEmail = document.querySelector('.auth-menu-email');
    const signOutButton = document.querySelector('.auth-menu-item.sign-out');
    const authError = document.querySelector('.auth-error');

    // Entry elements
    const entryInput = document.querySelector('.entry-input');
    const entriesList = document.querySelector('.entries-list');
    const imageUpload = document.querySelector('#image-upload');
    const imagePreviewContainer = document.querySelector('.image-preview-container');
    const uploadProgress = document.querySelector('.upload-progress');
    const submitButton = document.querySelector('.submit-button');
    const shortcutHint = document.querySelector('.shortcut-hint');
    const timeDisplay = document.querySelector('.time-display');
    const imageViewer = document.querySelector('.image-viewer');
    const imageViewerImg = imageViewer?.querySelector('img');
    const imageViewerClose = imageViewer?.querySelector('.image-viewer-close');
    const deleteDialog = document.querySelector('#delete-dialog');
    const menuItems = document.querySelector('.menu-items');
    const menuContainer = document.querySelector('.menu-container');
    const menuOverlay = document.querySelector('.menu-overlay');
    const mobileMenuToggle = document.querySelector('.mobile-menu-toggle');
    const calendarButton = document.querySelector('.menu-item.calendar-button');

    // Add calendar button click handler
    if (calendarButton) {
        calendarButton.addEventListener('click', () => {
            // Close mobile menu if it's open
            if (menuContainer && menuOverlay) {
                menuContainer.classList.remove('active');
                menuOverlay.classList.remove('active');
                document.body.style.overflow = ''; // Restore scrolling
            }
            
            createCalendarView();
        });
    }

    let currentUser = null;

    // Auth state handling
    onAuthChange((user) => {
        currentUser = user;
        if (user) {
            // Show skeletons while loading
            showSkeletonProfile();
            showSkeletonEntries();
            LOADING_STATES.profile = true;
            LOADING_STATES.entries = true;

            // User is signed in
            document.body.classList.remove('not-authenticated');
            container?.classList.remove('not-authenticated');
            authHeader?.classList.remove('not-authenticated');
            menuContainer?.classList.remove('hidden');
            mobileMenuToggle?.classList.remove('hidden');
            
            // Load profile picture with fade-in
            const img = new Image();
            img.onload = () => {
                const profileHTML = `<img src="${user.photoURL}" alt="${user.displayName}">`;
                authButton.innerHTML = profileHTML;
                welcomeAuthButton.innerHTML = profileHTML;
                authButton.classList.remove('sign-in');
                welcomeAuthButton.classList.remove('sign-in');
                LOADING_STATES.profile = false;
                if (!LOADING_STATES.entries) hideSkeletons();
            };
            img.src = user.photoURL;

            authMenuUser.textContent = user.displayName;
            authMenuEmail.textContent = user.email;
            
            // Save user data and migrate localStorage entries
            saveUserData(user.uid, {
                displayName: user.displayName,
                email: user.email,
                photoURL: user.photoURL,
                lastLogin: new Date()
            }).then(() => {
                migrateLocalStorageToFirebase(user).then(() => {
                    loadEntries(); // Load entries after migration
                });
            });
        } else {
            // User is signed out
            document.body.classList.add('not-authenticated');
            container?.classList.add('not-authenticated');
            authHeader?.classList.add('not-authenticated');
            menuContainer?.classList.add('hidden');
            mobileMenuToggle?.classList.add('hidden');
            const signInHTML = `
                <img src="./assets/google-icon.svg" alt="Google">
                <span>Sign in with Google</span>
            `;
            authButton.innerHTML = signInHTML;
            welcomeAuthButton.innerHTML = signInHTML;
            authButton.classList.add('sign-in');
            welcomeAuthButton.classList.add('sign-in');
            authMenuUser.textContent = '';
            authMenuEmail.textContent = '';
            journalEntries = []; // Clear entries
            entriesList.innerHTML = ''; // Clear UI
            menuItems.innerHTML = ''; // Clear sidebar history
            // Hide menu if it's open
            authMenu.classList.remove('active');
            menuContainer?.classList.remove('active');
            menuOverlay?.classList.remove('active');
            document.body.style.overflow = ''; // Restore scrolling
        }
    });

    // Auth button click handlers
    if (authButton) {
        authButton.addEventListener('click', async (e) => {
            e.stopPropagation();
            
            if (currentUser) {
                // Toggle menu if authenticated
                const buttonRect = authButton.getBoundingClientRect();
                authMenu.style.top = `${buttonRect.bottom + 8}px`;
                authMenu.style.right = `${window.innerWidth - buttonRect.right}px`;
                authMenu.classList.toggle('active');
            } else {
                // Sign in if not authenticated
                try {
                    await signInWithGoogle();
                } catch (error) {
                    // Show error message if sign-in was cancelled
                    if (error.code === 'auth/popup-closed-by-user' || error.code === 'auth/cancelled-popup-request') {
                        authError.classList.add('active');
                        setTimeout(() => {
                            authError.classList.remove('active');
                        }, 3000);
                    }
                }
            }
        });
    }

    // Welcome auth button click handler
    if (welcomeAuthButton) {
        welcomeAuthButton.addEventListener('click', async () => {
            try {
                await signInWithGoogle();
            } catch (error) {
                // Show error message if sign-in was cancelled
                if (error.code === 'auth/popup-closed-by-user' || error.code === 'auth/cancelled-popup-request') {
                    authError.classList.add('active');
                    setTimeout(() => {
                        authError.classList.remove('active');
                    }, 3000);
                }
            }
        });
    }

    // Close auth menu when clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.auth-menu') && !e.target.closest('.auth-button')) {
            authMenu.classList.remove('active');
        }
    });

    // Sign out button click handler
    if (signOutButton) {
        signOutButton.addEventListener('click', async () => {
            await signOutUser();
            authMenu.classList.remove('active');
        });
    }

    let entryToDelete = null;

    // Data structure for entries
    const STORAGE_KEY = 'journal_entries';
    let journalEntries = [];

    // Load entries from localStorage with proper date handling
    async function loadEntries() {
        if (!currentUser) return;
        
        const startTime = performance.now();
        log('Loading entries for user:', currentUser.uid);
        
        // Show skeleton if not already showing
        if (!document.querySelector('.skeleton-entries')) {
            showSkeletonEntries();
        }
        
        try {
            // Try to load from cache first
            const { entries: cachedEntries, isStale } = await getFromCache(currentUser.uid);
            if (cachedEntries.length > 0) {
                log('Cache hit! Using', cachedEntries.length, 'cached entries', isStale ? '(stale)' : '');
                journalEntries = cachedEntries;
                displayAllEntries();
                updateJournalHistory();
                
                // Hide skeletons after content is loaded
                LOADING_STATES.entries = false;
                if (!LOADING_STATES.profile) hideSkeletons();
                
                // If cache is stale, fetch updates in background
                if (isStale) {
                    log('Cache is stale, fetching updates in background...');
                    setTimeout(async () => {
                        await fetchAndMergeUpdates(currentUser.uid, cachedEntries);
                    }, 0);
                    return;
                }
            } else {
                log('Cache miss or empty cache');
            }

            await fetchAndMergeUpdates(currentUser.uid, cachedEntries);
            logPerformance('Total Load Operation', startTime);
            
            // Hide skeletons after content is loaded
            LOADING_STATES.entries = false;
            if (!LOADING_STATES.profile) hideSkeletons();
        } catch (error) {
            console.error('Error loading entries:', error);
            log('Failed to load entries:', error.message);
            journalEntries = [];
            
            // Hide skeletons on error
            LOADING_STATES.entries = false;
            if (!LOADING_STATES.profile) hideSkeletons();
        }
    }

    // Save entries to localStorage with proper date handling
    function saveEntries() {
        try {
            const entriesToSave = journalEntries.map(entry => ({
                content: entry.content,
                date: entry.date.getTime(),
                images: entry.images || []
            }));
            localStorage.setItem(STORAGE_KEY, JSON.stringify(entriesToSave));
            console.log('Saved entries:', entriesToSave); // Debug log
        } catch (error) {
            console.error('Error saving entries:', error);
        }
    }

    // Display all entries grouped by date
    function displayAllEntries(weekOffset = DISPLAY_CONFIG.currentWeekOffset) {
        entriesList.innerHTML = '';
        
        // First, sort all entries by date (newest first)
        journalEntries.sort((a, b) => new Date(b.date) - new Date(a.date));
        
        // Calculate week boundaries
        const today = new Date();
        const startOfCurrentWeek = new Date(today);
        startOfCurrentWeek.setHours(0, 0, 0, 0);
        startOfCurrentWeek.setDate(today.getDate() - today.getDay()); // Start of current week (Sunday)
        
        const startOfTargetWeek = new Date(startOfCurrentWeek);
        startOfTargetWeek.setDate(startOfCurrentWeek.getDate() - (7 * weekOffset));
        
        const endOfTargetWeek = new Date(startOfTargetWeek);
        endOfTargetWeek.setDate(startOfTargetWeek.getDate() + 6);
        endOfTargetWeek.setHours(23, 59, 59, 999);
        
        // Filter entries for the target week
        const weekEntries = journalEntries.filter(entry => {
            const entryDate = new Date(entry.date);
            return entryDate >= startOfTargetWeek && entryDate <= endOfTargetWeek;
        });
        
        // Group entries by date
        const groupedEntries = {};
        const todayKey = formatDateKey(new Date());
        
        weekEntries.forEach(entry => {
            const dateKey = formatDateKey(new Date(entry.date));
            if (!groupedEntries[dateKey]) {
                groupedEntries[dateKey] = [];
            }
            groupedEntries[dateKey].push(entry);
        });
        
        // Sort dates in descending order
        const sortedDates = Object.keys(groupedEntries).sort((a, b) => new Date(b) - new Date(a));
        
        // Add entries for each date
        sortedDates.forEach(dateKey => {
            const entries = groupedEntries[dateKey];
            const dateGroup = getOrCreateDateGroup(new Date(entries[0].date));
            
            // Sort entries based on whether it's today or not
            if (dateKey === todayKey) {
                // Today's entries: newest first
                entries.sort((a, b) => new Date(b.date) - new Date(a.date));
            } else {
                // Past entries: oldest first
                entries.sort((a, b) => new Date(a.date) - new Date(b.date));
            }
            
            // Clear existing entries in the group
            dateGroup.innerHTML = '';
            
            // Add entries to the group
            entries.forEach(entry => {
                const entryElement = createEntryElement(entry.content, new Date(entry.date), entry.images);
                dateGroup.appendChild(entryElement);
            });
        });
        
        // Add week navigation after today's group or at the top if no today's group
        const weekNav = document.createElement('div');
        weekNav.className = 'pagination-controls week-nav';
        
        // Format date range for display
        const formatWeekDisplay = (date) => {
            return date.toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: date.getFullYear() !== today.getFullYear() ? 'numeric' : undefined
            });
        };
        
        const weekDisplay = weekOffset === 0 
            ? 'This Week' 
            : weekOffset === 1 
                ? 'Last Week'
                : `${formatWeekDisplay(startOfTargetWeek)} - ${formatWeekDisplay(endOfTargetWeek)}`;
        
        weekNav.innerHTML = `
            <button class="pagination-button prev" ${weekOffset >= 52 ? 'disabled' : ''}>
                <span class="material-icons-outlined">chevron_left</span>
                Previous Week
            </button>
            <span class="pagination-info">${weekDisplay}</span>
            <button class="pagination-button next" ${weekOffset === 0 ? 'disabled' : ''}>
                Next Week
                <span class="material-icons-outlined">chevron_right</span>
            </button>
        `;
        
        // Add click handlers for week navigation
        const prevButton = weekNav.querySelector('.prev');
        const nextButton = weekNav.querySelector('.next');
        
        prevButton.addEventListener('click', () => {
            if (weekOffset < 52) { // Limit to one year in the past
                DISPLAY_CONFIG.currentWeekOffset = weekOffset + 1;
                displayAllEntries(DISPLAY_CONFIG.currentWeekOffset);
                window.scrollTo(0, 0);
            }
        });
        
        nextButton.addEventListener('click', () => {
            if (weekOffset > 0) {
                DISPLAY_CONFIG.currentWeekOffset = weekOffset - 1;
                displayAllEntries(DISPLAY_CONFIG.currentWeekOffset);
                window.scrollTo(0, 0);
            }
        });
        
        // Insert week navigation after today's group or at the top
        const todayGroup = document.querySelector(`.date-group[data-date="${todayKey}"]`);
        if (todayGroup) {
            todayGroup.after(weekNav);
        } else {
            entriesList.prepend(weekNav);
        }

        // After filtering entries for the current week
        if (weekEntries.length === 0) {
            const emptyState = document.createElement('div');
            emptyState.className = 'empty-week-state';
            
            // Format the week range for display
            const weekStart = new Date();
            weekStart.setDate(weekStart.getDate() - weekStart.getDay() + (DISPLAY_CONFIG.currentWeekOffset * 7));
            const weekEnd = new Date(weekStart);
            weekEnd.setDate(weekStart.getDate() + 6);
            
            const formatDate = (date) => {
                return date.toLocaleDateString('en-US', { 
                    month: 'long', 
                    day: 'numeric',
                    year: weekStart.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined
                });
            };
            
            const weekRange = `${formatDate(weekStart)} - ${formatDate(weekEnd)}`;
            
            emptyState.innerHTML = `
                <h3>No entries this week</h3>
                <p>Start writing to see your entries appear here.</p>
            `;
            
            entriesList.appendChild(emptyState);
        }
    }

    // Update shortcut hint based on OS
    shortcutHint.textContent = navigator.platform.includes('Mac') ? '⌘+Enter' : 'Ctrl+Enter';

    const friendlyPrompts = [
        "hey, how's your day going?",
        "what's on your mind?",
        "anything you wanna talk about?",
        "how are you feeling?",
        "what's new with you?",
        "had any interesting thoughts today?",
        "what's been keeping you busy?",
        "anything exciting happen today?",
        "rough day? wanna talk about it?",
        "what made you smile today?",
        "got something on your mind?",
        "need to vent?"
    ];

    function setRandomPrompt() {
        const randomIndex = Math.floor(Math.random() * friendlyPrompts.length);
        entryInput.placeholder = friendlyPrompts[randomIndex];
    }

    setRandomPrompt();

    let currentEntry = '';
    let images = [];

    // Update time display
    function updateTimeDisplay() {
        const now = new Date();
        const timeStr = now.toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
        });
        const dateStr = now.toLocaleDateString('en-US', {
            weekday: 'short',
            month: 'short',
            day: 'numeric'
        });
        timeDisplay.textContent = `${dateStr}, ${timeStr}`;
        
        // Update gradient when updating time
        updateTimeBasedGradient();
    }

    // Update time every second
    updateTimeDisplay();
    setInterval(updateTimeDisplay, 1000);

    function updateProgress() {
        if (images.length === 0) {
            uploadProgress.innerHTML = '';
            return;
        }
        uploadProgress.innerHTML = `
            <div class="progress-text">
                ${images.length} image${images.length !== 1 ? 's' : ''} attached
            </div>`;
    }

    function createImagePreview(file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            const previewDiv = document.createElement('div');
            previewDiv.className = 'image-preview';
            
            const img = document.createElement('img');
            img.src = e.target.result;
            
            const removeButton = document.createElement('button');
            removeButton.className = 'remove-image';
            removeButton.innerHTML = '<span class="material-icons-outlined">close</span>';
            removeButton.onclick = () => {
                images = images.filter(image => image !== e.target.result);
                previewDiv.remove();
                updateProgress();
            };

            previewDiv.appendChild(img);
            previewDiv.appendChild(removeButton);
            imagePreviewContainer.appendChild(previewDiv);
            
            images.push(e.target.result);
            updateProgress();
        };
        reader.readAsDataURL(file);
    }

    imageUpload.addEventListener('change', (e) => {
        const files = Array.from(e.target.files).filter(file => file.type.startsWith('image/'));
        files.forEach(createImagePreview);
        imageUpload.value = '';
    });

    // Save entry when Enter is pressed with Ctrl/Cmd
    entryInput.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            saveEntry();
        }
    });

    // Add click handler for submit button
    submitButton.addEventListener('click', saveEntry);

    function formatDateKey(date) {
        return date.toLocaleDateString('en-US', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        });
    }

    function getOrCreateDateGroup(date) {
        const dateKey = formatDateKey(date);
        let group = document.querySelector(`.date-group[data-date="${dateKey}"]`);
        
        if (!group) {
            group = document.createElement('div');
            group.className = 'date-group';
            group.dataset.date = dateKey;

            // Check if this is today's date
            const today = new Date();
            const isToday = formatDateKey(today) === dateKey;
            if (isToday) {
                group.classList.add('today');
            }
            
            const header = document.createElement('div');
            header.className = 'date-group-header';
            header.innerHTML = `
                <div class="date-group-title">
                    <button class="date-group-toggle">
                        <span class="material-icons-outlined">expand_more</span>
                    </button>
                    ${date.toLocaleDateString('en-US', {
                        weekday: 'long',
                        month: 'long',
                        day: 'numeric',
                        year: 'numeric'
                    })}
                </div>
            `;
            
            const entriesContainer = document.createElement('div');
            entriesContainer.className = 'date-group-entries';
            
            // Add click handler to the entire header
            header.addEventListener('click', (e) => {
                // Don't toggle if clicking on an action button or menu
                if (e.target.closest('.entry-actions')) return;
                
                const isCollapsed = group.classList.contains('collapsed');
                const entriesContainer = group.querySelector('.date-group-entries');
                
                if (isCollapsed) {
                    // Expanding
                    group.classList.remove('collapsed');
                    // Set explicit height for animation
                    entriesContainer.style.maxHeight = entriesContainer.scrollHeight + 'px';
                } else {
                    // Collapsing
                    entriesContainer.style.maxHeight = entriesContainer.scrollHeight + 'px';
                    // Force reflow
                    entriesContainer.offsetHeight;
                    group.classList.add('collapsed');
                    entriesContainer.style.maxHeight = '0';
                }
            });
            
            group.appendChild(header);
            group.appendChild(entriesContainer);
            
            // Insert in correct chronological order (newest first)
            let inserted = false;
            const existingGroups = document.querySelectorAll('.date-group');
            for (const existingGroup of existingGroups) {
                if (new Date(existingGroup.dataset.date) < new Date(dateKey)) {
                    existingGroup.parentNode.insertBefore(group, existingGroup);
                    inserted = true;
                    break;
                }
            }
            if (!inserted) {
                entriesList.appendChild(group);
            }
        }
        
        return group.querySelector('.date-group-entries');
    }

    // Function to clean up empty date groups - moved outside other functions
    function cleanupEmptyGroups() {
        document.querySelectorAll('.date-group').forEach(group => {
            const entriesContainer = group.querySelector('.date-group-entries');
            if (!entriesContainer.hasChildNodes()) {
                group.remove();
            }
        });
    }

    function createEntryElement(content, date, entryImages) {
        const entry = document.createElement('div');
        entry.className = 'entry';
        
        // Create actions menu
        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'entry-actions';
        actionsDiv.innerHTML = `
            <button class="entry-actions-button">
                <span class="material-icons-outlined">more_vert</span>
            </button>
            <div class="entry-actions-menu">
                <div class="entry-action-item edit">
                    <span class="material-icons-outlined">edit</span>
                    Edit
                </div>
                <div class="entry-action-item move">
                    <span class="material-icons-outlined">edit_calendar</span>
                    Move
                </div>
                <div class="entry-action-item delete">
                    <span class="material-icons-outlined">delete</span>
                    Delete
                </div>
            </div>
        `;

        // Add time
        const timeDiv = document.createElement('div');
        timeDiv.className = 'entry-time';
        timeDiv.textContent = date.toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
        });
        
        const contentDiv = document.createElement('div');
        contentDiv.className = 'entry-content';
        contentDiv.textContent = content;

        // Add edit area
        const editArea = document.createElement('div');
        editArea.className = 'entry-edit-area';
        editArea.innerHTML = `
            <textarea class="entry-edit-input">${content}</textarea>
            <div class="image-upload-wrapper">
                <input type="file" id="edit-image-upload-${Date.now()}" class="image-upload" multiple accept="image/*">
                <label class="upload-button" for="edit-image-upload-${Date.now()}">
                    <span class="material-icons-outlined">add_photo_alternate</span>
                    Add Images
                </label>
            </div>
            <div class="image-preview-container edit-preview-container"></div>
            <div class="upload-progress edit-progress"></div>
            <div class="entry-edit-actions">
                <button class="dialog-button cancel">Cancel</button>
                <button class="dialog-button submit">Save Changes</button>
            </div>
        `;

        // Initialize edit area image handling
        const editImageUpload = editArea.querySelector('.image-upload');
        const editPreviewContainer = editArea.querySelector('.edit-preview-container');
        const editProgress = editArea.querySelector('.edit-progress');
        let editImages = [...entryImages]; // Clone the current images array

        function updateEditProgress() {
            if (editImages.length === 0) {
                editProgress.innerHTML = '';
                return;
            }
            editProgress.innerHTML = `
                <div class="progress-text">
                    ${editImages.length} image${editImages.length !== 1 ? 's' : ''} attached
                </div>`;
        }

        function createEditImagePreview(imgData, isExisting = false) {
            const previewDiv = document.createElement('div');
            previewDiv.className = 'image-preview';
            
            const img = document.createElement('img');
            img.src = imgData;
            
            const removeButton = document.createElement('button');
            removeButton.className = 'remove-image';
            removeButton.innerHTML = '<span class="material-icons-outlined">close</span>';
            removeButton.onclick = () => {
                editImages = editImages.filter(image => image !== imgData);
                previewDiv.remove();
                updateEditProgress();
            };

            previewDiv.appendChild(img);
            previewDiv.appendChild(removeButton);
            editPreviewContainer.appendChild(previewDiv);
            
            if (!isExisting) {
                editImages.push(imgData);
            }
            updateEditProgress();
        }

        // Display existing images in edit mode
        entryImages.forEach(imgData => createEditImagePreview(imgData, true));
        updateEditProgress();

        // Handle new image uploads in edit mode
        editImageUpload.addEventListener('change', (e) => {
            const files = Array.from(e.target.files).filter(file => file.type.startsWith('image/'));
            files.forEach(file => {
                const reader = new FileReader();
                reader.onload = (e) => createEditImagePreview(e.target.result);
                reader.readAsDataURL(file);
            });
            editImageUpload.value = '';
        });

        entry.appendChild(actionsDiv);
        entry.appendChild(timeDiv);
        entry.appendChild(contentDiv);
        entry.appendChild(editArea);

        if (entryImages.length > 0) {
            const imagesDiv = document.createElement('div');
            imagesDiv.className = 'entry-images';
            
            entryImages.forEach(imgData => {
                const imgWrapper = document.createElement('div');
                imgWrapper.className = 'entry-image-wrapper';
                
                const img = document.createElement('img');
                img.src = imgData;
                img.loading = 'lazy';
                
                // Add click handler for full-screen view
                imgWrapper.onclick = () => {
                    imageViewerImg.src = imgData;
                    imageViewer.classList.add('active');
                };
                
                imgWrapper.appendChild(img);
                imagesDiv.appendChild(imgWrapper);
            });
            
            entry.appendChild(imagesDiv);
        }

        // Add event listeners for entry actions
        const actionsButton = actionsDiv.querySelector('.entry-actions-button');
        const actionsMenu = actionsDiv.querySelector('.entry-actions-menu');
        const editButton = actionsMenu.querySelector('.edit');
        const deleteButton = actionsMenu.querySelector('.delete');
        const moveButton = actionsMenu.querySelector('.move');

        actionsButton.onclick = (e) => {
            e.stopPropagation();
            
            // Close all other open menus first
            document.querySelectorAll('.entry-actions-menu.active').forEach(menu => {
                if (menu !== actionsMenu) {
                    menu.classList.remove('active');
                }
            });

            // Position the menu relative to the button
            const buttonRect = actionsButton.getBoundingClientRect();
            actionsMenu.style.top = `${buttonRect.bottom + 4}px`;
            actionsMenu.style.left = `${buttonRect.right - actionsMenu.offsetWidth}px`;
            
            // Move menu to body if not already there
            if (actionsMenu.parentElement !== document.body) {
                document.body.appendChild(actionsMenu);
            }
            
            actionsMenu.classList.toggle('active');
        };

        editButton.onclick = () => {
            entry.classList.add('editing');
            actionsMenu.classList.remove('active');
        };

        deleteButton.onclick = () => {
            entryToDelete = entry;
            deleteDialog.classList.add('active');
            actionsMenu.classList.remove('active');
        };

        // Move functionality
        moveButton.onclick = () => {
            // Close the actions menu
            actionsMenu.classList.remove('active');
            
            // Get current group's date and entry time
            const currentGroup = entry.closest('.date-group');
            const currentDate = new Date(currentGroup.dataset.date);
            const timeElement = entry.querySelector('.entry-time');
            const currentTime = timeElement ? timeElement.textContent : new Date().toLocaleTimeString('en-US', {
                hour: 'numeric',
                minute: '2-digit',
                hour12: true
            });
            
            // Convert time to 24-hour format for input
            const [time, period] = currentTime.split(' ');
            const [hours, minutes] = time.split(':');
            let hour = parseInt(hours);
            if (period === 'PM' && hour !== 12) hour += 12;
            if (period === 'AM' && hour === 12) hour = 0;
            currentDate.setHours(hour);
            currentDate.setMinutes(parseInt(minutes));
            
            const timeString = `${hour.toString().padStart(2, '0')}:${minutes}`;
            const dateString = currentDate.toLocaleDateString('en-CA'); // YYYY-MM-DD format using Canadian locale
            
            // Create move dialog
            const moveDialog = document.createElement('div');
            moveDialog.className = 'dialog-overlay';
            moveDialog.innerHTML = `
                <div class="dialog">
                    <div class="dialog-title">Move Entry</div>
                    <div class="dialog-content">
                        <div class="move-date-picker">
                            <label>Select new date:</label>
                            <input type="date" class="entry-move-date" value="${dateString}">
                            <label style="margin-top: 12px;">Select new time:</label>
                            <input type="time" class="entry-move-time" value="${timeString}">
                        </div>
                    </div>
                    <div class="dialog-actions">
                        <button class="dialog-button cancel">Cancel</button>
                        <button class="dialog-button submit">Move</button>
                    </div>
                </div>
            `;
            
            document.body.appendChild(moveDialog);
            moveDialog.classList.add('active');
            
            const dateInput = moveDialog.querySelector('.entry-move-date');
            const timeInput = moveDialog.querySelector('.entry-move-time');
            const cancelButton = moveDialog.querySelector('.cancel');
            const submitButton = moveDialog.querySelector('.submit');
            
            cancelButton.onclick = () => {
                moveDialog.remove();
            };
            
            submitButton.onclick = async () => {
                if (!currentUser) return;

                try {
                    // Create date with local timezone
                    const [year, month, day] = dateInput.value.split('-').map(Number);
                    const newDate = new Date(year, month - 1, day); // month is 0-based in Date constructor
                    const [newHours, newMinutes] = timeInput.value.split(':');
                    newDate.setHours(parseInt(newHours), parseInt(newMinutes), 0, 0); // Reset seconds and milliseconds
                    
                    const newGroup = getOrCreateDateGroup(newDate);
                    const oldGroup = entry.closest('.date-group');
                    
                    // Get the entry's content and current date/time for matching
                    const entryContent = entry.querySelector('.entry-content').textContent;
                    
                    // Find the entry in journalEntries array
                    const entryIndex = journalEntries.findIndex(e => {
                        // Compare content first as it's more unique
                        if (e.content !== entryContent) return false;
                        
                        // Convert both dates to local time strings for comparison
                        const eDate = new Date(e.date);
                        const eLocalTime = eDate.toLocaleTimeString('en-US', {
                            hour: 'numeric',
                            minute: '2-digit',
                            hour12: true
                        });
                        const eLocalDate = eDate.toLocaleDateString('en-US', {
                            year: 'numeric',
                            month: '2-digit',
                            day: '2-digit'
                        });
                        
                        // Get the current entry's displayed time and date
                        const currentTime = entry.querySelector('.entry-time').textContent;
                        const currentDate = oldGroup.dataset.date;
                        
                        return eLocalTime === currentTime && eLocalDate === currentDate;
                    });
                    
                    if (entryIndex !== -1) {
                        const updatedEntry = {
                            ...journalEntries[entryIndex],
                            date: newDate
                        };
                        
                        // Update in Firebase
                        await updateEntry(updatedEntry.id, {
                            date: newDate
                        });
                        
                        // Update local array
                        journalEntries[entryIndex] = updatedEntry;
                        
                        // Update the time display in the entry
                        const timeStr = newDate.toLocaleTimeString('en-US', {
                            hour: 'numeric',
                            minute: '2-digit',
                            hour12: true
                        });
                        timeDiv.textContent = timeStr;
                        
                        // Move the entry to the new group
                        newGroup.insertBefore(entry, newGroup.firstChild);
                        moveDialog.remove();
                        
                        // Clean up the old group if it's now empty
                        if (!oldGroup.querySelector('.date-group-entries').hasChildNodes()) {
                            oldGroup.remove();
                        }
                    }
                } catch (error) {
                    console.error('Error moving entry:', error);
                    alert('Failed to move entry. Please try again.');
                }
            };
            
            // Close dialog when clicking outside
            moveDialog.onclick = (e) => {
                if (e.target === moveDialog) {
                    moveDialog.remove();
                }
            };
        };

        // Edit actions
        const editActions = editArea.querySelector('.entry-edit-actions');
        const cancelEdit = editActions.querySelector('.cancel');
        const saveEdit = editActions.querySelector('.submit');

        cancelEdit.onclick = () => {
            entry.classList.remove('editing');
            editArea.querySelector('textarea').value = content;
            editImages = [...entryImages];
            editPreviewContainer.innerHTML = '';
            entryImages.forEach(imgData => createEditImagePreview(imgData, true));
            updateEditProgress();
        };

        saveEdit.onclick = async () => {
            if (!currentUser) return;

            const newContent = editArea.querySelector('textarea').value.trim();
            if (newContent || editImages.length > 0) {
                try {
                    // Upload any new images first
                    const uploadedImages = [];
                    for (const imageData of editImages) {
                        if (imageData.startsWith('data:')) {
                            // This is a new image that needs to be uploaded
                            const response = await fetch(imageData);
                            const blob = await response.blob();
                            const file = new File([blob], `image_${Date.now()}.jpg`, { type: 'image/jpeg' });
                            
                            const { url, path } = await uploadImage(currentUser.uid, file);
                            uploadedImages.push(url);
                        } else {
                            // This is an existing image URL
                            uploadedImages.push(imageData);
                        }
                    }

                    // Update content
                    contentDiv.textContent = newContent;

                    // Update images
                    const oldImagesDiv = entry.querySelector('.entry-images');
                    if (oldImagesDiv) {
                        oldImagesDiv.remove();
                    }

                    if (uploadedImages.length > 0) {
                        const imagesDiv = document.createElement('div');
                        imagesDiv.className = 'entry-images';
                        
                        uploadedImages.forEach(imgData => {
                            const imgWrapper = document.createElement('div');
                            imgWrapper.className = 'entry-image-wrapper';
                            
                            const img = document.createElement('img');
                            img.src = imgData;
                            img.loading = 'lazy';
                            
                            imgWrapper.onclick = () => {
                                imageViewerImg.src = imgData;
                                imageViewer.classList.add('active');
                            };
                            
                            imgWrapper.appendChild(img);
                            imagesDiv.appendChild(imgWrapper);
                        });
                        
                        entry.appendChild(imagesDiv);
                    }

                    // Find the entry in journalEntries
                    const timeElement = entry.querySelector('.entry-time');
                    const dateGroup = entry.closest('.date-group');
                    const entryDate = new Date(dateGroup.dataset.date);
                    
                    if (timeElement) {
                        const [time, period] = timeElement.textContent.split(' ');
                        const [hours, minutes] = time.split(':');
                        let hour = parseInt(hours);
                        
                        if (period === 'PM' && hour !== 12) hour += 12;
                        if (period === 'AM' && hour === 12) hour = 0;
                        
                        entryDate.setHours(hour);
                        entryDate.setMinutes(parseInt(minutes));
                    }
                    
                    const entryIndex = journalEntries.findIndex(e => {
                        const eDate = new Date(e.date);
                        return eDate.getTime() === entryDate.getTime() && e.content === content;
                    });
                    
                    if (entryIndex !== -1) {
                        const updatedEntry = {
                            ...journalEntries[entryIndex],
                            content: newContent,
                            images: uploadedImages
                        };
                        
                        // Update in Firebase
                        await updateEntry(updatedEntry.id, {
                            content: newContent,
                            images: uploadedImages
                        });
                        
                        // Update local array
                        journalEntries[entryIndex] = updatedEntry;
                    }

                    entry.classList.remove('editing');
                } catch (error) {
                    console.error('Error updating entry:', error);
                    alert('Failed to update entry. Please try again.');
                }
            }
        };

        // Close menus when clicking outside
        document.addEventListener('click', (e) => {
            const clickedMenu = e.target.closest('.entry-actions-menu');
            const clickedButton = e.target.closest('.entry-actions-button');
            
            if (!clickedMenu && !clickedButton) {
                document.querySelectorAll('.entry-actions-menu.active').forEach(menu => {
                    menu.classList.remove('active');
                });
            }
        });

        return entry;
    }

    async function saveEntry() {
        if (!currentUser) return;
        
        const content = entryInput.value.trim();
        if (!content && images.length === 0) return;

        const startTime = performance.now();
        log('Saving new entry...');

        try {
            // Upload images first if any
            const uploadedImages = [];
            if (images.length > 0) {
                log('Uploading', images.length, 'images');
                for (const imageData of images) {
                    const response = await fetch(imageData);
                    const blob = await response.blob();
                    const file = new File([blob], `image_${Date.now()}.jpg`, { type: 'image/jpeg' });
                    
                    const { url, path } = await uploadImage(currentUser.uid, file);
                    uploadedImages.push({ url, path });
                    log('Uploaded image:', path);
                }
            }

            const newEntry = {
                content,
                date: new Date(),
                images: uploadedImages.map(img => img.url)
            };

            // Save to Firebase
            log('Saving entry to Firebase...');
            const saveStartTime = performance.now();
            const entryId = await saveEntryToDb(currentUser.uid, newEntry);
            logPerformance('Firebase Save', saveStartTime);
            newEntry.id = entryId;
            log('Entry saved with ID:', entryId);

            // Add to cache
            await addToCache(currentUser.uid, newEntry);

            // Update local state and UI
            journalEntries.unshift(newEntry);
            
            const entry = createEntryElement(content, newEntry.date, newEntry.images);
            const dateGroup = getOrCreateDateGroup(newEntry.date);
            
            // Animate the entry addition
            entry.style.opacity = '0';
            entry.style.transform = 'translateY(20px)';
            dateGroup.insertBefore(entry, dateGroup.firstChild);
            
            entry.offsetHeight; // Trigger reflow
            
            entry.style.transition = 'all 0.3s ease';
            entry.style.opacity = '1';
            entry.style.transform = 'translateY(0)';

            // Clear form
            entryInput.value = '';
            images = [];
            imagePreviewContainer.innerHTML = '';
            updateProgress();
            
            setRandomPrompt();
            updateJournalHistory();
            
            logPerformance('Total Save Operation', startTime);
        } catch (error) {
            console.error('Error saving entry:', error);
            log('Failed to save entry:', error.message);
            alert('Failed to save entry. Please try again.');
        }
    }

    // Image viewer controls
    imageViewerClose.onclick = () => {
        imageViewer.classList.remove('active');
        imageViewerImg.src = '';
    };

    // Close image viewer with escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            imageViewer.classList.remove('active');
            imageViewerImg.src = '';
        }
    });

    // Delete dialog controls
    const cancelDelete = deleteDialog.querySelector('.cancel');
    const confirmDelete = deleteDialog.querySelector('.delete');

    cancelDelete.onclick = () => {
        deleteDialog.classList.remove('active');
        entryToDelete = null;
    };

    // Function to delete entry and update storage
    async function deleteEntry(entry) {
        if (!currentUser) return;

        const dateGroup = entry.closest('.date-group');
        const content = entry.querySelector('.entry-content').textContent;
        const timeElement = entry.querySelector('.entry-time');
        const currentDate = new Date(dateGroup.dataset.date);
        
        if (timeElement) {
            const [time, period] = timeElement.textContent.split(' ');
            const [hours, minutes] = time.split(':');
            let hour = parseInt(hours);
            
            if (period === 'PM' && hour !== 12) hour += 12;
            if (period === 'AM' && hour === 12) hour = 0;
            
            currentDate.setHours(hour);
            currentDate.setMinutes(parseInt(minutes));
        }

        const entryIndex = journalEntries.findIndex(e => {
            if (e.content !== content) return false;
            
            const eDate = new Date(e.date);
            const eTime = eDate.toLocaleTimeString('en-US', {
                hour: 'numeric',
                minute: '2-digit',
                hour12: true
            });
            const displayedTime = timeElement.textContent;
            
            const eDateStr = eDate.toLocaleDateString('en-US', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit'
            });
            const currentDateStr = currentDate.toLocaleDateString('en-US', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit'
            });
            
            return eTime === displayedTime && eDateStr === currentDateStr;
        });
        
        if (entryIndex !== -1) {
            try {
                const entryToDelete = journalEntries[entryIndex];
                
                // Delete any associated images first
                if (entryToDelete.images && entryToDelete.images.length > 0) {
                    for (const imageUrl of entryToDelete.images) {
                        try {
                            await deleteImage(imageUrl);
                            if (DEBUG) {
                                log(`Deleted image: ${imageUrl}`);
                            }
                        } catch (error) {
                            console.error('Error deleting image:', error);
                            // Continue with entry deletion even if image deletion fails
                        }
                    }
                }

                await deleteEntryFromDb(entryToDelete.id);
                
                // Remove from cache
                await removeFromCache(currentUser.uid, entryToDelete.id);
                
                // Update local state and UI
                journalEntries.splice(entryIndex, 1);
                entry.remove();
                
                if (!dateGroup.querySelector('.date-group-entries').hasChildNodes()) {
                    dateGroup.remove();
                }
            } catch (error) {
                console.error('Error deleting entry:', error);
                alert('Failed to delete entry. Please try again.');
            }
        }
    }

    // Update the confirm delete handler
    confirmDelete.onclick = () => {
        if (entryToDelete) {
            deleteEntry(entryToDelete);
            deleteDialog.classList.remove('active');
            entryToDelete = null;
        }
    };

    // Close dialog when clicking outside
    deleteDialog.onclick = (e) => {
        if (e.target === deleteDialog) {
            deleteDialog.classList.remove('active');
            entryToDelete = null;
        }
    };

    // Load entries when the page loads
    loadEntries();

    // Add this function after loadEntries()
    function updateJournalHistory() {
        // Save the calendar button if it exists
        const calendarButton = menuItems.querySelector('.calendar-button');
        
        // Clear existing history
        menuItems.innerHTML = '';
        
        // Restore the calendar button
        if (calendarButton) {
            menuItems.appendChild(calendarButton);
        }
        
        // Group entries by date
        const groupedEntries = {};
        const today = new Date().toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric'
        });
        
        // Only process the most recent entries for the sidebar
        const recentEntries = journalEntries.slice(0, DISPLAY_CONFIG.sidebarPreviewItems);
        
        recentEntries.forEach(entry => {
            const date = new Date(entry.date);
            const dateKey = date.toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric'
            });
            
            if (!groupedEntries[dateKey]) {
                groupedEntries[dateKey] = [];
            }
            groupedEntries[dateKey].push(entry);
        });

        // Get dates and sort them (newest to oldest)
        const dates = Object.keys(groupedEntries).sort((a, b) => {
            return new Date(b) - new Date(a);
        });

        // Create history items
        dates.forEach(dateKey => {
            const entries = groupedEntries[dateKey];
            
            // Create date header
            const dateHeader = document.createElement('div');
            dateHeader.className = `menu-item date-header${dateKey === today ? ' today' : ''}`;
            dateHeader.innerHTML = `
                <span class="material-icons-outlined">calendar_today</span>
                <div class="history-date">${dateKey}</div>
            `;
            menuItems.appendChild(dateHeader);

            // Sort entries based on whether it's today or not
            if (dateKey === today) {
                // Today's entries: newest first
                entries.sort((a, b) => new Date(b.date) - new Date(a.date));
            } else {
                // Past entries: oldest first
                entries.sort((a, b) => new Date(a.date) - new Date(b.date));
            }
            
            // Add entries under the date
            entries.forEach(entry => {
                const timeStr = new Date(entry.date).toLocaleTimeString('en-US', {
                    hour: 'numeric',
                    minute: '2-digit',
                    hour12: true
                });
                
                const historyItem = document.createElement('div');
                historyItem.className = 'menu-item entry-item';
                
                historyItem.innerHTML = `
                    <span class="material-icons-outlined">schedule</span>
                    <div class="history-item-content">
                        <div class="history-time">${timeStr}</div>
                        <div class="history-preview">${entry.content.substring(0, 30)}${entry.content.length > 30 ? '...' : ''}</div>
                    </div>
                `;
                
                // Add click handler to scroll to entry
                historyItem.addEventListener('click', () => {
                    const entryDate = new Date(entry.date);
                    
                    // Calculate which week this entry belongs to
                    const today = new Date();
                    const startOfCurrentWeek = new Date(today);
                    startOfCurrentWeek.setHours(0, 0, 0, 0);
                    startOfCurrentWeek.setDate(today.getDate() - today.getDay()); // Start of current week (Sunday)
                    
                    const entryWeekStart = new Date(entryDate);
                    entryWeekStart.setHours(0, 0, 0, 0);
                    entryWeekStart.setDate(entryDate.getDate() - entryDate.getDay()); // Start of entry's week
                    
                    // Calculate the difference in weeks
                    const diffWeeks = Math.round((startOfCurrentWeek - entryWeekStart) / (7 * 24 * 60 * 60 * 1000));
                    
                    // If entry is in a different week, update the week offset and redisplay
                    if (diffWeeks !== DISPLAY_CONFIG.currentWeekOffset) {
                        DISPLAY_CONFIG.currentWeekOffset = diffWeeks;
                        displayAllEntries(diffWeeks);
                    }
                    
                    // Close mobile menu if it's open
                    if (menuContainer && menuOverlay) {
                        menuContainer.classList.remove('active');
                        menuOverlay.classList.remove('active');
                        document.body.style.overflow = ''; // Restore scrolling
                    }

                    // Now find and scroll to the entry
                    const dateGroup = document.querySelector(`.date-group[data-date="${formatDateKey(entryDate)}"]`);
                    if (dateGroup) {
                        dateGroup.scrollIntoView({ behavior: 'smooth' });
                        // Ensure the group is expanded
                        dateGroup.classList.remove('collapsed');
                        const entriesContainer = dateGroup.querySelector('.date-group-entries');
                        if (entriesContainer) {
                            entriesContainer.style.maxHeight = entriesContainer.scrollHeight + 'px';
                        }
                        
                        // Find and highlight the specific entry
                        const entryElement = Array.from(dateGroup.querySelectorAll('.entry')).find(el => {
                            const timeEl = el.querySelector('.entry-time');
                            return timeEl && timeEl.textContent === timeStr;
                        });
                        
                        if (entryElement) {
                            // Remove highlight from all entries
                            document.querySelectorAll('.entry').forEach(e => e.classList.remove('highlighted'));
                            document.querySelectorAll('.menu-item').forEach(item => item.classList.remove('active'));
                            
                            // Add highlight to clicked entry
                            entryElement.classList.add('highlighted');
                            historyItem.classList.add('active');
                            
                            // Ensure the entry is visible
                            setTimeout(() => {
                                entryElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
                            }, 100); // Small delay to ensure the week view has updated
                        }
                    }
                });
                
                menuItems.appendChild(historyItem);
            });
        });
    }

    // Mobile menu handling
    if (mobileMenuToggle && menuContainer && menuOverlay) {
        mobileMenuToggle.addEventListener('click', () => {
            menuContainer.classList.add('active');
            menuOverlay.classList.add('active');
            document.body.style.overflow = 'hidden'; // Prevent scrolling when menu is open
        });

        // Close menu when clicking overlay
        menuOverlay.addEventListener('click', () => {
            menuContainer.classList.remove('active');
            menuOverlay.classList.remove('active');
            document.body.style.overflow = ''; // Restore scrolling
        });

        // Close menu when pressing escape
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && menuContainer.classList.contains('active')) {
                menuContainer.classList.remove('active');
                menuOverlay.classList.remove('active');
                document.body.style.overflow = ''; // Restore scrolling
            }
        });
    }

    // Add after the onAuthChange function
    async function migrateLocalStorageToFirebase(user) {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
            try {
                const parsed = JSON.parse(stored);
                const entries = parsed.map(entry => ({
                    ...entry,
                    date: new Date(entry.date)
                }));
                
                // Save each entry to Firebase
                for (const entry of entries) {
                    await saveEntryToDb(user.uid, entry);
                }
                
                // Clear localStorage after successful migration
                localStorage.removeItem(STORAGE_KEY);
                console.log('Successfully migrated entries to Firebase');
            } catch (error) {
                console.error('Error migrating entries to Firebase:', error);
            }
        }
    }

    // Add new function to handle background updates
    async function fetchAndMergeUpdates(userId, cachedEntries) {
        try {
            const lastSync = await getLastSyncTime(userId);
            log('Last sync time:', lastSync ? lastSync.toISOString() : 'never');

            const fetchStartTime = performance.now();
            // Remove the lastSync parameter to fetch ALL entries initially
            const entries = await getUserEntries(userId);
            logPerformance('Firebase Fetch', fetchStartTime);
            log('Received', entries.length, 'entries from Firebase');
            
            if (entries.length > 0) {
                // Sort by date (newest first)
                entries.sort((a, b) => new Date(b.date) - new Date(a.date));
                
                // Update cache with all entries
                await updateCache(userId, entries);
                
                // Update UI
                log('Updating UI with fetched data');
                journalEntries = entries;
                displayAllEntries();
                updateJournalHistory();
            } else {
                log('No entries found in Firebase');
            }
        } catch (error) {
            log('Error fetching updates:', error);
            console.error('Error fetching updates:', error);
        }
    }

    // Add skeleton UI functions
    function showSkeletonProfile() {
        if (!authButton) return;
        authButton.innerHTML = `
            <div class="skeleton-profile">
                <div class="skeleton-circle"></div>
            </div>
        `;
        authButton.classList.add('loading');
    }

    function showSkeletonEntries() {
        if (!entriesList) return;
        
        const skeleton = document.createElement('div');
        skeleton.className = 'skeleton-entries';
        skeleton.innerHTML = `
            <div class="skeleton-date-group">
                <div class="skeleton-header"></div>
                <div class="skeleton-entry">
                    <div class="skeleton-time"></div>
                    <div class="skeleton-content">
                        <div class="skeleton-line"></div>
                        <div class="skeleton-line"></div>
                    </div>
                </div>
                <div class="skeleton-entry">
                    <div class="skeleton-time"></div>
                    <div class="skeleton-content">
                        <div class="skeleton-line"></div>
                        <div class="skeleton-line short"></div>
                    </div>
                </div>
            </div>
            <div class="skeleton-date-group">
                <div class="skeleton-header"></div>
                <div class="skeleton-entry">
                    <div class="skeleton-time"></div>
                    <div class="skeleton-content">
                        <div class="skeleton-line"></div>
                        <div class="skeleton-line"></div>
                    </div>
                </div>
            </div>
        `;
        entriesList.innerHTML = '';
        entriesList.appendChild(skeleton);
    }

    function hideSkeletons() {
        // Hide profile skeleton
        if (authButton) {
            authButton.classList.remove('loading');
        }
        
        // Hide entries skeleton
        const skeletonEntries = document.querySelector('.skeleton-entries');
        if (skeletonEntries) {
            skeletonEntries.remove();
        }
    }

    // Initial gradient update
    updateTimeBasedGradient();
    
    // Update gradient every minute
    setInterval(updateTimeBasedGradient, 60000);

    // Add after updateJournalHistory function
    function createCalendarView() {
        const calendarDialog = document.createElement('div');
        calendarDialog.className = 'dialog-overlay calendar-overlay';
        
        const currentDate = new Date();
        let currentMonth = currentDate.getMonth();
        let currentYear = currentDate.getFullYear();
        
        function generateCalendar(month, year) {
            const firstDay = new Date(year, month, 1);
            const lastDay = new Date(year, month + 1, 0);
            const startingDay = firstDay.getDay();
            const totalDays = lastDay.getDate();
            
            // Get entries for the month
            const entriesByDate = {};
            journalEntries.forEach(entry => {
                const entryDate = new Date(entry.date);
                if (entryDate.getMonth() === month && entryDate.getFullYear() === year) {
                    const dateKey = entryDate.getDate();
                    if (!entriesByDate[dateKey]) {
                        entriesByDate[dateKey] = [];
                    }
                    entriesByDate[dateKey].push(entry);
                }
            });
            
            let calendarHTML = `
                <div class="dialog calendar-dialog">
                    <div class="calendar-header">
                        <button class="calendar-nav prev">
                            <span class="material-icons-outlined">chevron_left</span>
                        </button>
                        <h2>${MONTHS[month]} ${year}</h2>
                        <button class="calendar-nav next">
                            <span class="material-icons-outlined">chevron_right</span>
                        </button>
                    </div>
                    <div class="calendar-body">
                        <div class="calendar-weekdays">
                            <div>Sun</div>
                            <div>Mon</div>
                            <div>Tue</div>
                            <div>Wed</div>
                            <div>Thu</div>
                            <div>Fri</div>
                            <div>Sat</div>
                        </div>
                        <div class="calendar-days">
            `;
            
            // Add empty cells for days before the first day of the month
            for (let i = 0; i < startingDay; i++) {
                calendarHTML += '<div class="calendar-day empty"></div>';
            }
            
            // Add days of the month
            for (let day = 1; day <= totalDays; day++) {
                const entries = entriesByDate[day] || [];
                const isToday = day === currentDate.getDate() && 
                               month === currentDate.getMonth() && 
                               year === currentDate.getFullYear();
                
                calendarHTML += `
                    <div class="calendar-day${isToday ? ' today' : ''}${entries.length ? ' has-entries' : ''}" data-date="${year}-${month + 1}-${day}">
                        <span class="day-number">${day}</span>
                        ${entries.length ? `<span class="entry-count">${entries.length}</span>` : ''}
                    </div>
                `;
            }
            
            calendarHTML += `
                        </div>
                    </div>
                    <div class="dialog-actions">
                        <button class="dialog-button close">Close</button>
                    </div>
                </div>
            `;
            
            calendarDialog.innerHTML = calendarHTML;
            
            // Add event listeners
            const prevButton = calendarDialog.querySelector('.calendar-nav.prev');
            const nextButton = calendarDialog.querySelector('.calendar-nav.next');
            const closeButton = calendarDialog.querySelector('.dialog-button.close');
            
            prevButton.onclick = () => {
                if (month === 0) {
                    month = 11;
                    year--;
                } else {
                    month--;
                }
                generateCalendar(month, year);
            };
            
            nextButton.onclick = () => {
                if (month === 11) {
                    month = 0;
                    year++;
                } else {
                    month++;
                }
                generateCalendar(month, year);
            };
            
            closeButton.onclick = () => {
                calendarDialog.remove();
            };
            
            // Add click handlers for days with entries
            calendarDialog.querySelectorAll('.calendar-day.has-entries').forEach(dayElement => {
                dayElement.addEventListener('click', () => {
                    const [year, month, day] = dayElement.dataset.date.split('-').map(Number);
                    const selectedDate = new Date(year, month - 1, day);
                    
                    // Calculate which week this date belongs to
                    const today = new Date();
                    const startOfCurrentWeek = new Date(today);
                    startOfCurrentWeek.setHours(0, 0, 0, 0);
                    startOfCurrentWeek.setDate(today.getDate() - today.getDay()); // Start of current week (Sunday)
                    
                    const selectedWeekStart = new Date(selectedDate);
                    selectedWeekStart.setHours(0, 0, 0, 0);
                    selectedWeekStart.setDate(selectedDate.getDate() - selectedDate.getDay()); // Start of selected date's week
                    
                    // Calculate the difference in weeks
                    const diffWeeks = Math.round((startOfCurrentWeek - selectedWeekStart) / (7 * 24 * 60 * 60 * 1000));
                    
                    // Update the week offset and redisplay
                    if (diffWeeks !== DISPLAY_CONFIG.currentWeekOffset) {
                        DISPLAY_CONFIG.currentWeekOffset = diffWeeks;
                        displayAllEntries(diffWeeks);
                    }
                    
                    // Close the calendar dialog
                    calendarDialog.remove();
                    
                    // Find and scroll to the date group
                    const dateKey = formatDateKey(selectedDate);
                    const dateGroup = document.querySelector(`.date-group[data-date="${dateKey}"]`);
                    if (dateGroup) {
                        // Ensure the group is expanded
                        dateGroup.classList.remove('collapsed');
                        const entriesContainer = dateGroup.querySelector('.date-group-entries');
                        if (entriesContainer) {
                            entriesContainer.style.maxHeight = entriesContainer.scrollHeight + 'px';
                        }
                        
                        // Scroll to the date group
                        setTimeout(() => {
                            dateGroup.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        }, 100); // Small delay to ensure the week view has updated
                    }
                });
            });
        }
        
        generateCalendar(currentMonth, currentYear);
        document.body.appendChild(calendarDialog);
        
        // Close when clicking outside
        calendarDialog.addEventListener('click', (e) => {
            if (e.target === calendarDialog) {
                calendarDialog.remove();
            }
        });
        
        // Show the dialog
        requestAnimationFrame(() => {
            calendarDialog.classList.add('active');
        });
    }
}); 