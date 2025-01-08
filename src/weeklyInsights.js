import { collection, doc, setDoc, getDoc, query, where, orderBy, limit, getDocs, deleteDoc } from 'firebase/firestore';
import { db } from './firebase.js';
import { currentUser } from './auth.js';
import { showToast } from './toast.js';
import { getUserEntries, getUserSurveys } from './db.js';
import { weeklyStats } from './weeklyStats.js';

// Constants for insights
const INSIGHTS_CONFIG = {
    CACHE_DURATION: 24 * 60 * 60 * 1000, // 24 hours
    FIREBASE_COLLECTION: 'weeklyInsights',
    MIN_ENTRIES_FOR_INSIGHT: 1,
    MAX_WEEKS_TO_FETCH: 52 // 1 year max history
};

export class WeeklyInsightsManager {
    constructor() {
        this.currentWeekOffset = 0;
        this.anthropicKey = null;
        this.insightsCache = new Map();
    }

    /**
     * Initialize the insights manager with user's API key
     */
    async initialize(apiKey) {
        this.anthropicKey = apiKey;
        // Store API key in localStorage
        if (apiKey) {
            localStorage.setItem('anthropic_api_key', apiKey);
        }
    }

    /**
     * Calculate the start and end dates for a given week offset
     */
    getWeekBoundaries(weekOffset = 0) {
        const today = new Date();
        const startOfCurrentWeek = new Date(today);
        startOfCurrentWeek.setHours(0, 0, 0, 0);
        startOfCurrentWeek.setDate(today.getDate() - today.getDay()); // Start of week (Sunday)
        
        const startOfTargetWeek = new Date(startOfCurrentWeek);
        startOfTargetWeek.setDate(startOfCurrentWeek.getDate() - (7 * weekOffset));
        
        const endOfTargetWeek = new Date(startOfTargetWeek);
        endOfTargetWeek.setDate(startOfTargetWeek.getDate() + 6);
        endOfTargetWeek.setHours(23, 59, 59, 999);

        return { startOfTargetWeek, endOfTargetWeek };
    }

    /**
     * Format a date range for display
     */
    formatWeekRange(startDate, endDate) {
        const formatDate = (date) => {
            return date.toLocaleDateString('en-US', {
                month: 'long',
                day: 'numeric',
                year: date.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined
            });
        };
        return `${formatDate(startDate)} - ${formatDate(endDate)}`;
    }

    /**
     * Get insights for a specific week from cache or generate new ones
     */
    async getWeeklyInsights(weekOffset = 0) {
        if (!currentUser?.uid) {
            throw new Error('User must be authenticated to get insights');
        }

        const { startOfTargetWeek, endOfTargetWeek } = this.getWeekBoundaries(weekOffset);
        const weekKey = `${currentUser.uid}_${startOfTargetWeek.toISOString()}`;

        // Check cache first
        const cachedInsights = this.insightsCache.get(weekKey);
        if (cachedInsights && Date.now() - cachedInsights.timestamp < INSIGHTS_CONFIG.CACHE_DURATION) {
            return cachedInsights.data;
        }

        // Check Firebase
        const firebaseInsights = await this.getInsightsFromFirebase(startOfTargetWeek);
        if (firebaseInsights) {
            this.insightsCache.set(weekKey, {
                data: firebaseInsights,
                timestamp: Date.now()
            });
            return firebaseInsights;
        }

        return null;
    }

    /**
     * Generate new insights using Claude
     */
    async generateInsights(weekData, previousWeekData = null) {
        if (!this.anthropicKey) {
            throw new Error('Anthropic API key is required to generate insights');
        }

        const prompt = this.constructPrompt(weekData, previousWeekData);
        console.log('Prompt length:', prompt.length);
        
        try {
            console.log('Sending request to Cloud Function...');
            
            const response = await fetch('https://generateinsights-7mhis4htka-uc.a.run.app', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.anthropicKey}`
                },
                body: JSON.stringify({
                    prompt,
                    weekData,
                    previousWeekData,
                    max_tokens: 300
                })
            });

            if (!response.ok) {
                const error = await response.text();
                console.error('Cloud Function error response:', error);
                throw new Error(`Failed to generate insights: ${error}`);
            }

            const result = await response.json();
            console.log('Raw Cloud Function response:', result);
            
            if (!result.insights) {
                console.error('No insights in response:', result);
                throw new Error('No insights returned from Cloud Function');
            }

            // Clean up and return the insights text
            const cleanedInsights = result.insights.trim();
            console.log('Final cleaned insights:', cleanedInsights);
            
            // Get the correct week start date from the weekData
            const weekEntries = weekData.entries.entries || [];
            if (weekEntries.length > 0) {
                // Sort entries by date and get the first entry's date
                weekEntries.sort((a, b) => new Date(a.date) - new Date(b.date));
                const firstEntryDate = new Date(weekEntries[0].date);
                // Get the start of that week
                const weekStart = new Date(firstEntryDate);
                weekStart.setHours(0, 0, 0, 0);
                weekStart.setDate(firstEntryDate.getDate() - firstEntryDate.getDay()); // Start of week (Sunday)
                
                // Save insights with the correct week start date
                await this.saveInsightsToFirebase(weekStart, cleanedInsights);
            }
            
            return cleanedInsights;

        } catch (error) {
            console.error('Error generating insights:', error);
            console.error('Full error details:', {
                name: error.name,
                message: error.message,
                stack: error.stack
            });
            throw error;
        }
    }

    /**
     * Construct the prompt for Claude
     */
    constructPrompt(weekData, previousWeekData) {
        // Get user's name with fallback
        const userName = currentUser?.displayName?.split(/\s+/)[0] || 'friend';
        
        // Format date range
        const { startOfTargetWeek, endOfTargetWeek } = this.getWeekBoundaries(this.currentWeekOffset);
        const formatDate = (date) => {
            return date.toLocaleDateString('en-US', {
                weekday: 'short',
                month: 'short',
                day: 'numeric'
            });
        };

        // Get the journal entries
        const weekEntries = weekData.entries.entries || [];
        const entryDetails = weekEntries.map(entry => {
            const date = new Date(entry.date);
            return `[${formatDate(date)}]\n${entry.content}\n`;
        }).join('\n');

        return `You are a thoughtful and compassionate journaling assistant. Please read ${userName}'s journal entries from the week of ${formatDate(startOfTargetWeek)} to ${formatDate(endOfTargetWeek)} and provide a brief, honest, and empathetic response (max 250 words).

entries:
${entryDetails || 'No entries written yet this week.'}

Please write a response that:
1. Shows you've carefully read and understood their entries
2. Offers gentle support and encouragement
3. Maintains a warm but professional tone
4. Stays concise and focused`;
    }

    /**
     * Save insights to Firebase
     */
    async saveInsightsToFirebase(weekStart, insights) {
        if (!currentUser?.uid) return;

        // Create a deterministic document ID based on userId and weekStart
        const weekStartStr = weekStart.toISOString().split('T')[0];
        const docId = `${currentUser.uid}_${weekStartStr}`;
        
        const insightsRef = doc(db, INSIGHTS_CONFIG.FIREBASE_COLLECTION, docId);
        await setDoc(insightsRef, {
            userId: currentUser.uid,
            weekStart: weekStart.toISOString(),
            insights,
            createdAt: new Date().toISOString()
        });
    }

    /**
     * Delete insights from Firebase
     */
    async deleteInsightsFromFirebase(weekStart) {
        if (!currentUser?.uid) return;

        try {
            const weekStartStr = weekStart.toISOString().split('T')[0];
            const docId = `${currentUser.uid}_${weekStartStr}`;
            const insightsRef = doc(db, INSIGHTS_CONFIG.FIREBASE_COLLECTION, docId);
            
            // Check if document exists first
            const docSnap = await getDoc(insightsRef);
            if (docSnap.exists()) {
                await deleteDoc(insightsRef);
                console.log('Successfully deleted insights document');
            } else {
                console.log('No insights document to delete');
            }
            
            // Clear from cache regardless
            const weekKey = `${currentUser.uid}_${weekStart.toISOString()}`;
            this.insightsCache.delete(weekKey);
        } catch (error) {
            console.error('Error deleting insights:', error);
            throw error;
        }
    }

    /**
     * Get insights from Firebase
     */
    async getInsightsFromFirebase(weekStart) {
        if (!currentUser?.uid) return null;

        const insightsRef = collection(db, INSIGHTS_CONFIG.FIREBASE_COLLECTION);
        const q = query(
            insightsRef,
            where('userId', '==', currentUser.uid),
            where('weekStart', '==', weekStart.toISOString()),
            orderBy('createdAt', 'desc'),
            limit(1)
        );

        const snapshot = await getDocs(q);
        if (!snapshot.empty) {
            return snapshot.docs[0].data().insights;
        }

        return null;
    }

    /**
     * Create the insights dialog UI
     */
    async createInsightsDialog(weekOffset = 0) {
        const { startOfTargetWeek, endOfTargetWeek } = this.getWeekBoundaries(weekOffset);
        const weekRange = this.formatWeekRange(startOfTargetWeek, endOfTargetWeek);

        const dialog = document.createElement('div');
        dialog.className = 'dialog-overlay insights-overlay';
        dialog.innerHTML = `
            <div class="dialog insights-dialog">
                <div class="insights-header">
                    <h2>Weekly Insights</h2>
                    <div class="insights-date">${weekRange}</div>
                    <div class="insights-tabs">
                        <button class="tab-button active" data-tab="summary">Summary</button>
                        <button class="tab-button" data-tab="insights">AI Insights</button>
                    </div>
                </div>
                <div class="insights-content">
                    <div class="tab-content active" data-tab="summary">
                        <div class="weekly-stats-summary-grid">
                            <!-- Stats will be populated here -->
                        </div>
                    </div>
                    <div class="tab-content" data-tab="insights">
                        <div class="insights-status">
                            <!-- Insights or API key form will be shown here -->
                        </div>
                    </div>
                </div>
                <div class="dialog-actions">
                    <button class="dialog-button close">Close</button>
                </div>
            </div>
        `;

        // Add event listeners and populate data
        this.setupDialogEventListeners(dialog);
        await this.populateInsightsData(dialog, weekOffset);

        return dialog;
    }

    /**
     * Setup event listeners for the insights dialog
     */
    setupDialogEventListeners(dialog) {
        // Close dialog
        dialog.addEventListener('click', e => {
            if (e.target === dialog) {
                dialog.remove();
            }
        });

        const closeButton = dialog.querySelector('.close');
        closeButton.addEventListener('click', () => dialog.remove());

        // Tab switching
        const tabs = dialog.querySelectorAll('.tab-button');
        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                const tabName = tab.dataset.tab;
                
                // Update active tab
                tabs.forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                
                // Update active content
                const contents = dialog.querySelectorAll('.tab-content');
                contents.forEach(content => {
                    content.classList.toggle('active', content.dataset.tab === tabName);
                });
            });
        });
    }

    /**
     * Populate the insights dialog with data
     */
    async populateInsightsData(dialog, weekOffset) {
        const { startOfTargetWeek, endOfTargetWeek } = this.getWeekBoundaries(weekOffset);
        const summaryGrid = dialog.querySelector('.weekly-stats-summary-grid');
        const insightsStatus = dialog.querySelector('.insights-status');

        try {
            // Get current week's stats
            const currentStats = await weeklyStats.getWeekStats(startOfTargetWeek, endOfTargetWeek);
            
            // Get previous week's stats for comparison
            const prevWeekStart = new Date(startOfTargetWeek);
            prevWeekStart.setDate(prevWeekStart.getDate() - 7);
            const prevWeekEnd = new Date(endOfTargetWeek);
            prevWeekEnd.setDate(prevWeekEnd.getDate() - 7);
            const previousStats = await weeklyStats.getWeekStats(prevWeekStart, prevWeekEnd);

            // Calculate trends
            const trends = weeklyStats.calculateTrends(currentStats, previousStats);

            // Populate summary grid
            this.populateSummaryGrid(summaryGrid, currentStats, trends);

            // Check for existing insights
            const existingInsights = await this.getWeeklyInsights(weekOffset);
            
            if (existingInsights) {
                this.displayInsights(insightsStatus, existingInsights);
            } else {
                this.displayInsightForm(insightsStatus, currentStats, previousStats);
            }

        } catch (error) {
            console.error('Error populating insights:', error);
            summaryGrid.innerHTML = '<div class="error-message">Failed to load statistics</div>';
            insightsStatus.innerHTML = '<div class="error-message">Failed to load insights</div>';
        }
    }

    /**
     * Populate the summary grid with stats
     */
    populateSummaryGrid(grid, stats, trends) {
        const formatTrend = (trend) => {
            if (!trend) return '';
            const icon = trend.direction === 'up' ? '↑' : trend.direction === 'down' ? '↓' : '→';
            const className = trend.direction === 'up' ? 'positive' : trend.direction === 'down' ? 'negative' : '';
            return `<div class="insights-stat-trend ${className}">
                ${icon} ${trend.percentage.toFixed(1)}%
            </div>`;
        };

        grid.innerHTML = `
            <div class="insights-stat-card">
                <div class="insights-stat-label">Journal Entries</div>
                <div class="insights-stat-value">${stats.entries.total}</div>
                ${formatTrend(trends?.entries.total)}
            </div>
            <div class="insights-stat-card">
                <div class="insights-stat-label">Words Written</div>
                <div class="insights-stat-value">${stats.entries.wordCount}</div>
                ${formatTrend(trends?.entries.wordCount)}
            </div>
            <div class="insights-stat-card">
                <div class="insights-stat-label">Avg. Words/Entry</div>
                <div class="insights-stat-value">${stats.entries.averageWordsPerEntry}</div>
                ${formatTrend(trends?.entries.averageWords)}
            </div>
            <div class="insights-stat-card">
                <div class="insights-stat-label">Surveys Completed</div>
                <div class="insights-stat-value">${stats.surveys.total}/7</div>
                ${formatTrend(trends?.surveys.total)}
            </div>
            <div class="insights-stat-card">
                <div class="insights-stat-label">Average Day Rating</div>
                <div class="insights-stat-value">${stats.surveys.averages.overall.toFixed(1)}/10</div>
                ${formatTrend(trends?.surveys.overall)}
            </div>
            <div class="insights-stat-card">
                <div class="insights-stat-label">Total Expenses</div>
                <div class="insights-stat-value">$${stats.surveys.totalExpenses.toFixed(2)}</div>
                ${formatTrend(trends?.surveys.expenses)}
            </div>
            <div class="insights-stat-card">
                <div class="insights-stat-label">Most Active Time</div>
                <div class="insights-stat-value">${stats.summary.mostActiveTime || 'N/A'}</div>
            </div>
            <div class="insights-stat-card">
                <div class="insights-stat-label">Consistency Rate</div>
                <div class="insights-stat-value">${(stats.summary.consistency * 100).toFixed(0)}%</div>
                ${formatTrend(trends?.summary.consistency)}
            </div>
        `;

        // Add mood summary if available
        if (stats.summary.topMoods.length > 0) {
            const moodCard = document.createElement('div');
            moodCard.className = 'insights-stat-card';
            moodCard.innerHTML = `
                <div class="insights-stat-label">Top Moods</div>
                <div class="insights-stat-value">
                    ${stats.summary.topMoods.map(m => m.mood).join(' ')}
                </div>
            `;
            grid.appendChild(moodCard);
        }
    }

    /**
     * Display existing insights
     */
    displayInsights(container, insights) {
        // Convert newlines to <br> tags and preserve paragraph spacing
        const formattedInsights = insights
            .split('\n\n')  // Split into paragraphs
            .map(paragraph => paragraph.replace(/\n/g, '<br>'))  // Convert single newlines to <br>
            .join('</p><p>');  // Join paragraphs with proper HTML tags

        container.innerHTML = `
            <div class="insights-response">
                <div class="response-content">
                    <p>${formattedInsights}</p>
                </div>
                <div class="insights-actions">
                    <button class="insights-try-again">
                        <span class="material-icons-outlined">refresh</span>
                        Try Again
                    </button>
                </div>
            </div>
        `;

        // Handle try again button click
        const tryAgainButton = container.querySelector('.insights-try-again');
        tryAgainButton.addEventListener('click', async () => {
            try {
                // Get current and previous week stats
                const { startOfTargetWeek, endOfTargetWeek } = this.getWeekBoundaries(this.currentWeekOffset);
                
                // Delete existing insights before regenerating
                await this.deleteInsightsFromFirebase(startOfTargetWeek);
                
                const currentStats = await weeklyStats.getWeekStats(startOfTargetWeek, endOfTargetWeek);
                
                const prevWeekStart = new Date(startOfTargetWeek);
                prevWeekStart.setDate(prevWeekStart.getDate() - 7);
                const prevWeekEnd = new Date(endOfTargetWeek);
                prevWeekEnd.setDate(prevWeekEnd.getDate() - 7);
                const previousStats = await weeklyStats.getWeekStats(prevWeekStart, prevWeekEnd);

                // Show the form to regenerate insights
                this.displayInsightForm(container, currentStats, previousStats);
            } catch (error) {
                console.error('Error preparing to regenerate insights:', error);
                container.innerHTML = `
                    <div class="insights-status error">
                        <p>Failed to prepare for regeneration. Please try again.</p>
                        <p class="error-details">${error.message}</p>
                    </div>
                `;
            }
        });
    }

    /**
     * Display the form to generate new insights
     */
    displayInsightForm(container, currentStats, previousStats) {
        // Don't show form if there's no data
        if (currentStats.entries.total === 0 && currentStats.surveys.total === 0) {
            container.innerHTML = `
                <div class="insights-status empty">
                    <p>No data available for this week.</p>
                </div>
            `;
            return;
        }

        const savedKey = localStorage.getItem('anthropic_api_key');
        
        container.innerHTML = `
            <div class="insights-api-form">
                <label for="api-key">Anthropic API Key</label>
                <input type="password" 
                       id="api-key" 
                       class="insights-api-input"
                       placeholder="Enter your Claude API key"
                       value="${savedKey || ''}">
                <button class="insights-generate-button" ${savedKey ? '' : 'disabled'}>
                    Generate Insights
                </button>
            </div>
        `;

        const apiInput = container.querySelector('#api-key');
        const generateButton = container.querySelector('.insights-generate-button');

        // Enable/disable generate button based on API key
        apiInput.addEventListener('input', () => {
            generateButton.disabled = !apiInput.value.trim();
        });

        // Handle generate button click
        generateButton.addEventListener('click', async () => {
            const apiKey = apiInput.value.trim();
            if (!apiKey) return;

            try {
                generateButton.disabled = true;
                generateButton.textContent = 'Generating...';

                // Initialize with API key
                await this.initialize(apiKey);

                console.log('Generating insights...');
                // Generate insights
                const insights = await this.generateInsights(currentStats, previousStats);
                console.log('Generated insights:', insights);

                // Save to Firebase and cache
                const { startOfTargetWeek } = this.getWeekBoundaries(this.currentWeekOffset);
                console.log('Saving insights to Firebase for week:', startOfTargetWeek);
                
                try {
                    await this.saveInsightsToFirebase(startOfTargetWeek, insights);
                    console.log('Successfully saved insights to Firebase');
                } catch (saveError) {
                    console.error('Error saving to Firebase:', saveError);
                    // Continue displaying insights even if save fails
                    showToast('Generated insights but failed to save them. They may not persist between sessions.', 'warning');
                }

                // Display the insights
                this.displayInsights(container, insights);

            } catch (error) {
                console.error('Error in generate flow:', error);
                container.innerHTML = `
                    <div class="insights-status error">
                        <p>Failed to generate insights. Please try again.</p>
                        <p class="error-details">${error.message}</p>
                        <button class="insights-retry-button">
                            <span class="material-icons-outlined">refresh</span>
                            Ask again
                        </button>
                    </div>
                `;

                // Add retry button handler
                const retryButton = container.querySelector('.insights-retry-button');
                retryButton.addEventListener('click', () => {
                    this.displayInsightForm(container, currentStats, previousStats);
                });
            } finally {
                generateButton.disabled = false;
                generateButton.textContent = 'Generate Insights';
            }
        });
    }
}

// Export a singleton instance
export const weeklyInsights = new WeeklyInsightsManager(); 