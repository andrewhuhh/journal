import { dbService } from './db.js';
import { saveSurvey, getFirebaseSurveyForDate } from './db.js';
import { currentUser } from './auth.js';
import { showToast } from './toast.js';

// Survey configuration
const SURVEY_CONFIG = {
    steps: [
        {
            id: 'date',
            title: 'Select Date',
            question: 'Which day would you like to reflect on?',
            required: true
        },
        {
            id: 'metrics',
            title: 'Quick Stats',
            question: 'Track the day\'s numbers',
            required: false
        },
        {
            id: 'health',
            title: 'Health Check',
            question: 'How were your health choices?',
            required: true
        },
        {
            id: 'mood',
            title: 'Mood',
            question: 'How are you feeling?',
            required: true
        },
        {
            id: 'reflection',
            title: 'Daily Reflection',
            question: 'Any final thoughts about the day?',
            required: false
        },
        {
            id: 'overall',
            title: 'Overall Rating',
            question: 'Taking everything into account, how was your day?',
            required: true
        }
    ],
    ratings: {
        overall: { min: 1, max: 10 },
        health: { min: 1, max: 5 },
        hydration: { min: 1, max: 5 }
    },
    moods: ['😊', '😌', '😐', '😕', '😢', '😤', '😴', '🤔', '🥳', '😅', '😎', '🤓']
};

export class SurveyManager {
    constructor() {
        this.currentStep = 0;
        this.data = this.getInitialData();
        this.autoSaveTimeout = null;
    }

    getInitialData() {
        return {
            metrics: {
                expenses: null,
                poops: null
            },
            health: {
                score: null,
                hydration: null
            },
            mood: null,
            reflection: '',
            overall: null,
            metadata: {
                targetDate: null,
                inputDate: null,
                version: 1
            }
        };
    }

    async createSurveyDialog(targetDate = new Date()) {
        // Try to load existing draft or survey
        const existingData = await this.loadExistingData(targetDate);
        
        if (!existingData) {
            this.data = this.getInitialData();
            this.data.metadata.targetDate = targetDate.toISOString();
            this.data.metadata.inputDate = new Date().toISOString();
        }

        const dialog = document.createElement('div');
        dialog.className = 'dialog-overlay';
        dialog.innerHTML = `
            <div class="dialog survey-dialog">
                <div class="survey-progress">
                    <div class="survey-progress-fill" style="width: ${((this.currentStep + 1) / SURVEY_CONFIG.steps.length) * 100}%"></div>
                </div>
                ${await this.createStepContent(this.currentStep)}
            </div>
        `;

        // Add event listeners
        this.setupEventListeners(dialog);

        // Add active class after a brief delay to trigger animation
        requestAnimationFrame(() => {
            dialog.classList.add('active');
        });

        return dialog;
    }

    async loadExistingData(targetDate) {
        try {
            // First check if there's a completed survey
            const existingSurvey = await dbService.getSurveyForDate(targetDate.toISOString());
            if (existingSurvey) {
                const confirmReopen = confirm('You already have a completed survey for this date. Would you like to view it?');
                if (confirmReopen) {
                    this.data = existingSurvey.data;
                    this.currentStep = 0;
                    return true;
                }
                return false;
            }

            // Then check for drafts
            const draft = await dbService.loadDraft(targetDate.toISOString());
            if (draft) {
                // Automatically load the draft without asking
                this.data = {
                    ...this.getInitialData(),
                    ...draft.data,
                    metadata: {
                        ...this.getInitialData().metadata,
                        ...draft.data.metadata
                    }
                };
                this.currentStep = draft.currentStep || 0;
                return true;
            }
        } catch (error) {
            console.error('Error loading existing data:', error);
        }
        return false;
    }

    async createDateInput() {
        // Get dates in local timezone at midnight
        const currentDate = new Date(this.data.metadata.targetDate);
        currentDate.setHours(0, 0, 0, 0);
        
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);

        // Format dates for comparison and display
        const currentDateStr = this.formatDateForInput(currentDate);
        const todayStr = this.formatDateForInput(today);
        const yesterdayStr = this.formatDateForInput(yesterday);

        // Check if current date is custom (not today or yesterday)
        const isCustomDate = currentDateStr !== todayStr && currentDateStr !== yesterdayStr;

        // Check for drafts and existing surveys
        const todayDraft = await dbService.loadDraft(today.toISOString());
        const yesterdayDraft = await dbService.loadDraft(yesterday.toISOString());
        const todaySurvey = await dbService.hasSurveyForDate(today.toISOString());
        const yesterdaySurvey = await dbService.hasSurveyForDate(yesterday.toISOString());

        return `
            <div class="date-input-container">
                <input type="date" 
                       class="date-input ${isCustomDate ? 'selected' : ''}"
                       value="${currentDateStr}"
                       max="${todayStr}">
                <div class="quick-date-buttons">
                    <div class="quick-date-wrapper">
                        <button class="quick-date-button ${currentDateStr === todayStr ? 'selected' : ''}" 
                                data-date="${todayStr}"
                                ${todaySurvey ? 'disabled title="Survey already submitted"' : ''}>
                            Today, ${this.formatDate(today)}
                        </button>
                        ${todayDraft && !todaySurvey ? '<div class="draft-indicator"><span class="material-icons-outlined">check</span>Draft saved</div>' : ''}
                        ${todaySurvey ? '<div class="draft-indicator submitted"><span class="material-icons-outlined">task_alt</span>Submitted</div>' : ''}
                    </div>
                    <div class="quick-date-wrapper">
                        <button class="quick-date-button ${currentDateStr === yesterdayStr ? 'selected' : ''}" 
                                data-date="${yesterdayStr}"
                                ${yesterdaySurvey ? 'disabled title="Survey already submitted"' : ''}>
                            Yesterday, ${this.formatDate(yesterday)}
                        </button>
                        ${yesterdayDraft && !yesterdaySurvey ? '<div class="draft-indicator"><span class="material-icons-outlined">check</span>Draft saved</div>' : ''}
                        ${yesterdaySurvey ? '<div class="draft-indicator submitted"><span class="material-icons-outlined">task_alt</span>Submitted</div>' : ''}
                    </div>
                </div>
            </div>
        `;
    }

    formatDateForInput(date) {
        // Format date in YYYY-MM-DD format in local timezone
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    formatDate(date) {
        return date.toLocaleDateString('en-US', { 
            month: 'short', 
            day: 'numeric'
        });
    }

    createMetricsInputs() {
        return `
            <div class="metrics-group">
                <div class="metric-item" data-type="money">
                    <label>💰 Expenses</label>
                    <input type="text" 
                           class="metric-input" 
                           data-metric="expenses" 
                           placeholder="0.00"
                           value="${this.data.metrics.expenses !== null ? this.data.metrics.expenses.toFixed(2) : ''}"
                           inputmode="decimal">
                </div>
                <div class="metric-item" data-type="count">
                    <label>💩 Poops</label>
                    <input type="text" 
                           class="metric-input" 
                           data-metric="poops" 
                           placeholder="0"
                           value="${this.data.metrics.poops !== null ? this.data.metrics.poops : '0'}"
                           inputmode="numeric">
                    <div class="counter-controls">
                        <button class="counter-button increment">
                            <span class="material-icons-outlined">add</span>
                        </button>
                        <button class="counter-button decrement">
                            <span class="material-icons-outlined">remove</span>
                        </button>
                    </div>
                </div>
            </div>
        `;
    }

    createHealthInputs() {
        // Add selected state for existing ratings
        const healthButtons = Array.from({ length: 5 }, (_, i) => i + 1)
            .map(num => `
                <button class="rating-button ${this.data.health.score === num ? 'selected' : ''}" 
                        data-rating="${num}" 
                        data-type="health">
                    ${num}
                </button>
            `).join('');

        const hydrationButtons = Array.from({ length: 5 }, (_, i) => i + 1)
            .map(num => `
                <button class="rating-button ${this.data.health.hydration === num ? 'selected' : ''}" 
                        data-rating="${num}" 
                        data-type="hydration">
                    ${num}
                </button>
            `).join('');

        return `
            <div class="health-ratings">
                <label>Health Choices</label>
                <div class="rating-group health-rating">
                    ${healthButtons}
                </div>
                <label>Hydration Level</label>
                <div class="rating-group hydration-rating">
                    ${hydrationButtons}
                </div>
            </div>
        `;
    }

    createMoodInputs() {
        const moodButtons = SURVEY_CONFIG.moods
            .map(emoji => `
                <button class="mood-button ${emoji === this.data.mood ? 'selected' : ''}" 
                        data-mood="${emoji}">
                    ${emoji}
                </button>
            `).join('');

        return `
            <div class="mood-grid">
                ${moodButtons}
            </div>
        `;
    }

    createReflectionInput() {
        return `
            <textarea class="reflection-input" 
                      placeholder="Share your thoughts about today..."
                      rows="4">${this.data.reflection}</textarea>
        `;
    }

    createOverallInput() {
        const firstRow = Array.from({ length: 5 }, (_, i) => i + 1)
            .map(num => `
                <button class="rating-button" data-rating="${num}">
                    ${num}
                </button>
            `).join('');

        const secondRow = Array.from({ length: 5 }, (_, i) => i + 6)
            .map(num => `
                <button class="rating-button" data-rating="${num}">
                    ${num}
                </button>
            `).join('');

        return `
            <div class="rating-group overall-rating">
                <div class="rating-row">
                    ${firstRow}
                </div>
                <div class="rating-row">
                    ${secondRow}
                </div>
            </div>
        `;
    }

    setupEventListeners(dialog) {
        // Save state when dialog is closed
        dialog.addEventListener('click', e => {
            if (e.target === dialog) {
                this.saveDraft();
                dialog.remove();
            }
        });

        // Auto-save on all changes
        const debouncedSave = this.debounce(() => this.saveDraft(), 1000);

        // Date input and quick date buttons
        dialog.addEventListener('change', async e => {
            if (e.target.matches('.date-input')) {
                // Save current draft before switching
                await this.saveDraft();
                
                const newDate = new Date(e.target.value + 'T00:00:00');
                newDate.setHours(0, 0, 0, 0);
                
                // Try to load existing data for the new date
                const existingData = await this.loadExistingData(newDate);
                if (!existingData) {
                    // If no existing data, reset to initial state with new date
                    this.data = this.getInitialData();
                    this.data.metadata.targetDate = newDate.toISOString();
                    this.data.metadata.inputDate = new Date().toISOString();
                }
                
                // Update quick date buttons and input selection
                const dateStr = this.formatDateForInput(newDate);
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                const yesterday = new Date(today);
                yesterday.setDate(yesterday.getDate() - 1);
                
                const todayStr = this.formatDateForInput(today);
                const yesterdayStr = this.formatDateForInput(yesterday);
                
                const isCustomDate = dateStr !== todayStr && dateStr !== yesterdayStr;
                e.target.classList.toggle('selected', isCustomDate);
                
                dialog.querySelectorAll('.quick-date-button').forEach(btn => {
                    btn.classList.toggle('selected', btn.dataset.date === dateStr);
                });

                // Update the UI with new data
                this.updateStep(dialog);
            }
        });

        dialog.addEventListener('click', async e => {
            if (e.target.matches('.quick-date-button')) {
                // Save current draft before switching
                await this.saveDraft();
                
                const dateStr = e.target.dataset.date;
                const dateInput = dialog.querySelector('.date-input');
                dateInput.value = dateStr;
                dateInput.classList.remove('selected');
                
                const newDate = new Date(dateStr + 'T00:00:00');
                newDate.setHours(0, 0, 0, 0);
                
                // Try to load existing data for the new date
                const existingData = await this.loadExistingData(newDate);
                if (!existingData) {
                    // If no existing data, reset to initial state with new date
                    this.data = this.getInitialData();
                    this.data.metadata.targetDate = newDate.toISOString();
                    this.data.metadata.inputDate = new Date().toISOString();
                }

                // Update quick date buttons selection
                dialog.querySelectorAll('.quick-date-button').forEach(btn => {
                    btn.classList.toggle('selected', btn.dataset.date === dateStr);
                });

                // Update the UI with new data
                this.updateStep(dialog);
            }
        });

        // Navigation buttons
        dialog.addEventListener('click', e => {
            if (e.target.matches('.next')) {
                this.handleNext(dialog);
            } else if (e.target.matches('.back')) {
                this.handleBack(dialog);
            } else if (e.target.matches('.rating-button')) {
                this.handleRating(e.target);
                debouncedSave();
            } else if (e.target.matches('.mood-button')) {
                this.handleMood(e.target);
                debouncedSave();
            } else if (e.target.closest('.counter-button')) {
                const button = e.target.closest('.counter-button');
                const input = button.closest('.metric-item').querySelector('.metric-input');
                if (button.classList.contains('increment')) {
                    this.handleCounterIncrement(input);
                } else if (button.classList.contains('decrement')) {
                    this.handleCounterDecrement(input);
                }
                debouncedSave();
            }
        });

        // Input changes
        dialog.addEventListener('input', e => {
            if (e.target.matches('.metric-input')) {
                if (e.target.closest('[data-type="money"]')) {
                    this.handleMoneyInput(e.target);
                } else if (e.target.closest('[data-type="count"]')) {
                    this.handleCountInput(e.target);
                }
                debouncedSave();
            } else if (e.target.matches('.reflection-input')) {
                this.handleReflection(e.target);
                debouncedSave();
            }
        });
    }

    debounce(func, wait) {
        let timeout;
        return (...args) => {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), wait);
        };
    }

    async saveDraft() {
        try {
            const draft = {
                data: this.data,
                currentStep: this.currentStep,
                targetDate: this.data.metadata.targetDate,
                lastUpdated: new Date().toISOString()
            };
            await dbService.saveDraft(draft);
        } catch (error) {
            console.error('Error saving draft:', error);
        }
    }

    handleNext(dialog) {
        // Validate current step if it's required
        const currentStepConfig = SURVEY_CONFIG.steps[this.currentStep];
        if (currentStepConfig.required && !this.validateStep(currentStepConfig)) {
            // Show validation error
            const step = dialog.querySelector('.survey-step');
            this.showValidationError(step, currentStepConfig);
            return;
        }

        if (this.currentStep < SURVEY_CONFIG.steps.length - 1) {
            this.currentStep++;
            this.updateStep(dialog);
        } else {
            // Validate all required steps before final submission
            const missingSteps = SURVEY_CONFIG.steps
                .filter(step => step.required && !this.validateStep(step))
                .map(step => step.title);

            if (missingSteps.length > 0) {
                alert(`Please complete the following required steps:\n${missingSteps.join('\n')}`);
                return;
            }
            this.submitSurvey(dialog);
        }
    }

    validateStep(step) {
        switch (step.id) {
            case 'date':
                return this.data.metadata.targetDate != null;
            case 'metrics':
                // Only validate if there are any values set
                const hasExpenses = this.data.metrics.expenses !== null;
                const hasPoops = this.data.metrics.poops !== null;
                return !step.required || hasExpenses || hasPoops;
            case 'health':
                return this.data.health.score != null && this.data.health.hydration != null;
            case 'mood':
                return this.data.mood != null;
            case 'reflection':
                return !step.required || (this.data.reflection && this.data.reflection.trim().length > 0);
            case 'overall':
                return this.data.overall != null;
            default:
                return true;
        }
    }

    showValidationError(step, stepConfig) {
        // Remove any existing error message
        const existingError = step.querySelector('.validation-error');
        if (existingError) {
            existingError.remove();
        }

        // Add error message
        const error = document.createElement('div');
        error.className = 'validation-error';
        error.textContent = `Please complete all required fields for ${stepConfig.title.toLowerCase()}`;
        
        // Insert after the question
        const question = step.querySelector('.survey-step-question');
        question.insertAdjacentElement('afterend', error);

        // Add shake animation to the error message
        error.style.animation = 'shake 0.5s ease';
    }

    handleBack(dialog) {
        if (this.currentStep > 0) {
            this.currentStep--;
            this.updateStep(dialog);
            this.saveDraft(); // Save state when moving back
        }
    }

    async updateStep(dialog) {
        const progress = ((this.currentStep + 1) / SURVEY_CONFIG.steps.length) * 100;
        dialog.querySelector('.survey-progress-fill').style.width = `${progress}%`;
        
        const surveyDialog = dialog.querySelector('.survey-dialog');
        surveyDialog.innerHTML = `
            <div class="survey-progress">
                <div class="survey-progress-fill" style="width: ${progress}%"></div>
            </div>
            ${await this.createStepContent(this.currentStep)}
        `;
    }

    handleRating(button) {
        const rating = parseInt(button.dataset.rating);
        const type = button.dataset.type || 'overall';
        
        // Remove selection from other buttons in the same group
        const group = button.closest('.rating-group');
        group.querySelectorAll('.rating-button').forEach(btn => {
            btn.classList.remove('selected');
        });
        
        // Select this button
        button.classList.add('selected');
        
        // Store the rating
        if (type === 'overall') {
            this.data.overall = rating;
        } else if (type === 'health') {
            this.data.health.score = rating;
        } else if (type === 'hydration') {
            this.data.health.hydration = rating;
        }
    }

    handleMood(button) {
        const mood = button.dataset.mood;
        
        // Remove selection from other buttons
        button.closest('.mood-grid').querySelectorAll('.mood-button').forEach(btn => {
            btn.classList.remove('selected');
        });
        
        // Select this button
        button.classList.add('selected');
        
        // Store the mood
        this.data.mood = mood;
    }

    handleMoneyInput(input) {
        // Remove any non-numeric characters except decimal point
        let value = input.value.replace(/[^\d.]/g, '');
        
        // Ensure only one decimal point
        const parts = value.split('.');
        if (parts.length > 2) {
            value = parts[0] + '.' + parts.slice(1).join('');
        }
        
        // Update input value
        input.value = value || '0.00';
        
        // Store the numeric value
        const numericValue = parseFloat(value) || 0;
        this.data.metrics.expenses = numericValue;
    }

    handleCountInput(input) {
        // Remove any non-numeric characters
        let value = input.value.replace(/\D/g, '');
        
        // Ensure it's not empty and is a valid number
        value = value ? parseInt(value) : 0;
        
        // Update input value
        input.value = value.toString();
        
        // Store the numeric value
        this.data.metrics.poops = value;
    }

    handleCounterIncrement(input) {
        const currentValue = parseInt(input.value) || 0;
        input.value = (currentValue + 1).toString();
        this.data.metrics.poops = currentValue + 1;
    }

    handleCounterDecrement(input) {
        const currentValue = parseInt(input.value) || 0;
        if (currentValue > 0) {
            input.value = (currentValue - 1).toString();
            this.data.metrics.poops = currentValue - 1;
        }
    }

    handleReflection(input) {
        this.data.reflection = input.value.trim();
    }

    async submitSurvey(dialog) {
        try {
            // Show loading state
            const submitButton = dialog.querySelector('.next');
            submitButton.textContent = 'Submitting...';
            submitButton.disabled = true;

            // Submit to Firebase
            await saveSurvey(currentUser.uid, this.data);
            
            // Cache the survey
            await dbService.cacheSurvey({
                ...this.data,
                targetDate: this.data.metadata.targetDate
            });

            // Delete the draft after successful submission
            await dbService.deleteDraft(this.data.metadata.targetDate);

            // Show success message
            dialog.querySelector('.survey-dialog').innerHTML = `
                <div class="survey-success">
                    <div class="success-icon">✓</div>
                    <h2>Survey Submitted!</h2>
                    <p>Thank you for completing your daily reflection.</p>
                    <button class="dialog-button close">Close</button>
                </div>
            `;

            // Add close button handler
            dialog.querySelector('.close').addEventListener('click', () => {
                dialog.remove();
            });

            // Show success toast
            showToast('Survey submitted successfully!', 'success');

            // Auto close after 3 seconds
            setTimeout(() => {
                dialog.remove();
            }, 3000);

        } catch (error) {
            console.error('Error submitting survey:', error);
            if (error.message === 'A survey already exists for this date') {
                showToast('You have already submitted a survey for this date.', 'error');
            } else {
                showToast('Failed to submit survey. Please try again.', 'error');
            }
            
            // Reset submit button
            const submitButton = dialog.querySelector('.next');
            submitButton.textContent = 'Submit';
            submitButton.disabled = false;
        }
    }

    static async show(targetDate = new Date()) {
        const surveyManager = new SurveyManager();
        const dialog = await surveyManager.createSurveyDialog(targetDate);
        document.body.appendChild(dialog);
        return surveyManager;
    }

    static async viewSurvey(targetDate) {
        try {
            // Try to get from cache first
            let survey = await dbService.getCachedSurvey(targetDate);
            
            // If not in cache, get from Firebase
            if (!survey && currentUser?.uid) {
                survey = await getFirebaseSurveyForDate(currentUser.uid, targetDate);
                if (survey) {
                    // Cache for future use
                    await dbService.cacheSurvey({
                        ...survey,
                        targetDate
                    });
                }
            }

            if (!survey) {
                showToast('No survey found for this date', 'error');
                return;
            }

            const dialog = document.createElement('div');
            dialog.className = 'dialog-overlay';
            dialog.innerHTML = `
                <div class="dialog survey-dialog view-mode">
                    <div class="survey-header">
                        <h2>Survey for ${new Date(targetDate).toLocaleDateString()}</h2>
                    </div>
                    <div class="survey-content">
                        ${this.createSurveyView(survey)}
                    </div>
                    <div class="dialog-actions">
                        <button class="dialog-button close">Close</button>
                    </div>
                </div>
            `;

            // Add close handlers
            dialog.addEventListener('click', e => {
                if (e.target === dialog || e.target.matches('.close')) {
                    dialog.remove();
                }
            });

            document.body.appendChild(dialog);
            requestAnimationFrame(() => dialog.classList.add('active'));

        } catch (error) {
            console.error('Error viewing survey:', error);
            showToast('Failed to load survey. Please try again.', 'error');
        }
    }

    static createSurveyView(survey) {
        return `
            <div class="survey-section">
                <h3>Health</h3>
                <div class="survey-data">
                    <div class="data-item">
                        <label>Health Score:</label>
                        <span>${survey.health.score}/5</span>
                    </div>
                    <div class="data-item">
                        <label>Hydration:</label>
                        <span>${survey.health.hydration}/5</span>
                    </div>
                </div>
            </div>
            ${survey.metrics.expenses !== null || survey.metrics.poops !== null ? `
                <div class="survey-section">
                    <h3>Metrics</h3>
                    <div class="survey-data">
                        ${survey.metrics.expenses !== null ? `
                            <div class="data-item">
                                <label>💰 Expenses:</label>
                                <span>$${survey.metrics.expenses.toFixed(2)}</span>
                            </div>
                        ` : ''}
                        ${survey.metrics.poops !== null ? `
                            <div class="data-item">
                                <label>💩 Poops:</label>
                                <span>${survey.metrics.poops}</span>
                            </div>
                        ` : ''}
                    </div>
                </div>
            ` : ''}
            <div class="survey-section">
                <h3>Mood</h3>
                <div class="survey-data">
                    <div class="data-item mood">
                        <span class="mood-emoji">${survey.mood}</span>
                    </div>
                </div>
            </div>
            ${survey.reflection ? `
                <div class="survey-section">
                    <h3>Reflection</h3>
                    <div class="survey-data">
                        <p class="reflection-text">${survey.reflection}</p>
                    </div>
                </div>
            ` : ''}
            <div class="survey-section">
                <h3>Overall Rating</h3>
                <div class="survey-data">
                    <div class="data-item">
                        <span class="overall-rating">${survey.overall}/10</span>
                    </div>
                </div>
            </div>
        `;
    }

    // Make createStepContent async to handle async createDateInput
    async createStepContent(stepIndex) {
        const step = SURVEY_CONFIG.steps[stepIndex];
        let content;
        
        if (step.id === 'date') {
            content = await this.createDateInput();
        } else {
            content = this.createStepInputs(step);
        }

        return `
            <div class="survey-step active" data-step="${step.id}">
                <div class="survey-step-title">${step.title}</div>
                <div class="survey-step-question">${step.question}</div>
                ${content}
                <div class="survey-nav">
                    <button class="back" ${stepIndex === 0 ? 'disabled' : ''}>Back</button>
                    <button class="next">${stepIndex === SURVEY_CONFIG.steps.length - 1 ? 'Submit' : 'Next'}</button>
                </div>
            </div>
        `;
    }

    createStepInputs(step) {
        switch (step.id) {
            case 'metrics':
                return this.createMetricsInputs();
            case 'health':
                return this.createHealthInputs();
            case 'mood':
                return this.createMoodInputs();
            case 'reflection':
                return this.createReflectionInput();
            case 'overall':
                return this.createOverallInput();
            default:
                return '';
        }
    }
} 