import { currentUser } from './auth.js';
import { getUserEntries, getUserSurveys } from './db.js';

// Constants for stats caching
const STATS_CACHE_CONFIG = {
    DURATION: 24 * 60 * 60 * 1000, // 24 hours
    PREFIX: 'weekly_stats_'
};

class WeeklyStatsAggregator {
    constructor() {
        this.cache = new Map();
    }

    /**
     * Generate cache key for a week
     */
    getCacheKey(startDate, endDate) {
        if (!currentUser) return null;
        return `${STATS_CACHE_CONFIG.PREFIX}${currentUser.uid}_${startDate.toISOString()}_${endDate.toISOString()}`;
    }

    /**
     * Check if cached stats are valid
     */
    isCacheValid(cacheEntry) {
        if (!cacheEntry) return false;
        const age = Date.now() - cacheEntry.timestamp;
        return age < STATS_CACHE_CONFIG.DURATION;
    }

    /**
     * Get statistics for a specific week
     */
    async getWeekStats(startDate, endDate) {
        try {
            // Check cache first
            const cacheKey = this.getCacheKey(startDate, endDate);
            if (cacheKey) {
                const cachedStats = this.cache.get(cacheKey);
                if (this.isCacheValid(cachedStats)) {
                    console.log('Using cached stats for week:', { startDate, endDate });
                    return cachedStats.data;
                }
            }

            // Get entries and surveys for the week
            const [entries, surveys] = await Promise.all([
                this.getEntriesForWeek(startDate, endDate),
                this.getSurveysForWeek(startDate, endDate)
            ]);

            // Calculate statistics
            const entryStats = this.calculateEntryStats(entries);
            const surveyStats = this.calculateSurveyStats(surveys);
            const summaryStats = this.calculateSummaryStats(entries, surveys);

            // Include the actual entries in the stats
            entryStats.entries = entries;

            const stats = {
                entries: entryStats,
                surveys: surveyStats,
                summary: summaryStats
            };

            // Cache the results
            if (cacheKey) {
                this.cache.set(cacheKey, {
                    data: stats,
                    timestamp: Date.now()
                });
                console.log('Cached stats for week:', { startDate, endDate });
            }

            return stats;
        } catch (error) {
            console.error('Error getting week stats:', error);
            throw error;
        }
    }

    /**
     * Clear cache for a specific week or all weeks
     */
    clearCache(startDate = null, endDate = null) {
        if (startDate && endDate) {
            const cacheKey = this.getCacheKey(startDate, endDate);
            if (cacheKey) {
                this.cache.delete(cacheKey);
                console.log('Cleared cache for week:', { startDate, endDate });
            }
        } else {
            this.cache.clear();
            console.log('Cleared all cached stats');
        }
    }

    /**
     * Get entries for a specific week
     */
    async getEntriesForWeek(startDate, endDate) {
        if (!currentUser) return [];

        try {
            console.log('Fetching entries for week:', { startDate, endDate });
            const { entries } = await getUserEntries(currentUser.uid, {
                startDate: startDate,
                endDate: endDate
            });
            console.log('Received entries:', entries);
            return entries || [];
        } catch (error) {
            console.error('Error fetching entries:', error);
            return [];
        }
    }

    /**
     * Get surveys for a specific week
     */
    async getSurveysForWeek(startDate, endDate) {
        if (!currentUser) return [];

        try {
            console.log('Fetching surveys for week:', { startDate, endDate });
            
            // Convert dates to ISO strings for Firestore query
            const startIso = new Date(startDate).toISOString();
            const endIso = new Date(endDate).toISOString();
            
            console.log('Querying with ISO dates:', { startIso, endIso });
            
            const { surveys } = await getUserSurveys(currentUser.uid, {
                startDate: startIso,
                endDate: endIso
            });
            
            console.log('Received surveys:', surveys);
            return surveys || [];
        } catch (error) {
            console.error('Error fetching surveys:', error);
            return [];
        }
    }

    /**
     * Calculate statistics for entries
     */
    calculateEntryStats(entries) {
        const stats = {
            total: entries.length,
            wordCount: 0,
            averageWordsPerEntry: 0,
            timeOfDay: {
                morning: 0,   // 5am - 11:59am
                afternoon: 0, // 12pm - 4:59pm
                evening: 0,   // 5pm - 8:59pm
                night: 0      // 9pm - 4:59am
            },
            longestEntry: null,
            shortestEntry: null
        };

        if (entries.length === 0) return stats;

        entries.forEach(entry => {
            // Word count
            const words = entry.content.trim().split(/\s+/).length;
            stats.wordCount += words;

            // Time of day
            const hour = new Date(entry.date).getHours();
            if (hour >= 5 && hour < 12) stats.timeOfDay.morning++;
            else if (hour >= 12 && hour < 17) stats.timeOfDay.afternoon++;
            else if (hour >= 17 && hour < 21) stats.timeOfDay.evening++;
            else stats.timeOfDay.night++;

            // Longest/shortest entries
            if (!stats.longestEntry || words > stats.longestEntry.words) {
                stats.longestEntry = { id: entry.id, words };
            }
            if (!stats.shortestEntry || words < stats.shortestEntry.words) {
                stats.shortestEntry = { id: entry.id, words };
            }
        });

        stats.averageWordsPerEntry = Math.round(stats.wordCount / stats.total);

        return stats;
    }

    /**
     * Calculate statistics for surveys
     */
    calculateSurveyStats(surveys) {
        const stats = {
            total: surveys.length,
            averages: {
                overall: 0,
                health: 0,
                hydration: 0
            },
            totalExpenses: 0,
            moods: {}
        };

        if (surveys.length === 0) return stats;

        let totalOverall = 0;
        let totalHealth = 0;
        let totalHydration = 0;

        console.log('Processing surveys:', surveys);

        surveys.forEach(survey => {
            // Handle both direct survey data and nested data structure
            const data = survey.data || survey;
            console.log('Processing survey data:', data);

            // Averages
            if (data.overall) totalOverall += data.overall;
            if (data.health?.score) totalHealth += data.health.score;
            if (data.health?.hydration) totalHydration += data.health.hydration;

            // Expenses
            if (data.metrics?.expenses) {
                stats.totalExpenses += data.metrics.expenses;
            }

            // Moods
            if (data.mood) {
                stats.moods[data.mood] = (stats.moods[data.mood] || 0) + 1;
            }
        });

        // Only calculate averages if we have valid data
        const validSurveys = surveys.length;
        if (validSurveys > 0) {
            stats.averages.overall = totalOverall / validSurveys;
            stats.averages.health = totalHealth / validSurveys;
            stats.averages.hydration = totalHydration / validSurveys;
        }

        console.log('Calculated survey stats:', stats);
        return stats;
    }

    /**
     * Calculate summary statistics
     */
    calculateSummaryStats(entries, surveys) {
        const stats = {
            consistency: 0,
            topMoods: [],
            mostActiveTime: null
        };

        // Calculate consistency (entries + surveys) / total possible days
        const totalDays = 7;
        const uniqueDays = new Set([
            ...entries.map(e => new Date(e.date).toDateString()),
            ...surveys.map(s => new Date(s.date).toDateString())
        ]);
        stats.consistency = uniqueDays.size / totalDays;

        // Get top moods
        if (surveys.length > 0) {
            const moodCounts = {};
            surveys.forEach(survey => {
                if (survey.mood) {
                    moodCounts[survey.mood] = (moodCounts[survey.mood] || 0) + 1;
                }
            });
            stats.topMoods = Object.entries(moodCounts)
                .map(([mood, count]) => ({ mood, count }))
                .sort((a, b) => b.count - a.count)
                .slice(0, 3);
        }

        // Find most active time of day
        if (entries.length > 0) {
            const timeSlots = {
                'Morning': 0,
                'Afternoon': 0,
                'Evening': 0,
                'Night': 0
            };

            entries.forEach(entry => {
                const hour = new Date(entry.date).getHours();
                if (hour >= 5 && hour < 12) timeSlots['Morning']++;
                else if (hour >= 12 && hour < 17) timeSlots['Afternoon']++;
                else if (hour >= 17 && hour < 21) timeSlots['Evening']++;
                else timeSlots['Night']++;
            });

            stats.mostActiveTime = Object.entries(timeSlots)
                .reduce((a, b) => a[1] > b[1] ? a : b)[0];
        }

        return stats;
    }

    /**
     * Calculate trends compared to previous week
     */
    calculateTrends(currentStats, previousStats) {
        if (!previousStats) return null;

        const calculateTrend = (current, previous) => {
            if (!previous) return null;
            const change = ((current - previous) / previous) * 100;
            return {
                direction: change > 0 ? 'up' : change < 0 ? 'down' : 'same',
                percentage: Math.abs(change)
            };
        };

        return {
            entries: {
                total: calculateTrend(currentStats.entries.total, previousStats.entries.total),
                wordCount: calculateTrend(currentStats.entries.wordCount, previousStats.entries.wordCount),
                averageWords: calculateTrend(
                    currentStats.entries.averageWordsPerEntry,
                    previousStats.entries.averageWordsPerEntry
                )
            },
            surveys: {
                total: calculateTrend(currentStats.surveys.total, previousStats.surveys.total),
                overall: calculateTrend(
                    currentStats.surveys.averages.overall,
                    previousStats.surveys.averages.overall
                ),
                expenses: calculateTrend(
                    currentStats.surveys.totalExpenses,
                    previousStats.surveys.totalExpenses
                )
            },
            summary: {
                consistency: calculateTrend(
                    currentStats.summary.consistency,
                    previousStats.summary.consistency
                )
            }
        };
    }
}

// Export a singleton instance
export const weeklyStats = new WeeklyStatsAggregator(); 