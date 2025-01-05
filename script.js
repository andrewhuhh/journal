document.addEventListener('DOMContentLoaded', () => {
    const entryInput = document.querySelector('.entry-input');
    const entriesList = document.querySelector('.entries-list');
    const imageUpload = document.querySelector('#image-upload');
    const imagePreviewContainer = document.querySelector('.image-preview-container');
    const uploadProgress = document.querySelector('.upload-progress');
    const submitButton = document.querySelector('.submit-button');
    const shortcutHint = document.querySelector('.shortcut-hint');
    const timeDisplay = document.querySelector('.time-display');
    const imageViewer = document.querySelector('.image-viewer');
    const imageViewerImg = imageViewer.querySelector('img');
    const imageViewerClose = imageViewer.querySelector('.image-viewer-close');
    const deleteDialog = document.querySelector('#delete-dialog');
    
    let entryToDelete = null;

    // Data structure for entries
    const STORAGE_KEY = 'journal_entries';
    let journalEntries = [];

    // Load entries from localStorage with proper date handling
    function loadEntries() {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
            try {
                const parsed = JSON.parse(stored);
                journalEntries = parsed.map(entry => ({
                    ...entry,
                    date: new Date(entry.date)
                }));
                displayAllEntries();
            } catch (error) {
                console.error('Error loading entries:', error);
                journalEntries = [];
            }
        }
    }

    // Save entries to localStorage with proper date handling
    function saveEntries() {
        try {
            const entriesToSave = journalEntries.map(entry => ({
                content: entry.content,
                date: entry.date.toISOString(),
                images: entry.images || []
            }));
            localStorage.setItem(STORAGE_KEY, JSON.stringify(entriesToSave));
            console.log('Saved entries:', entriesToSave); // Debug log
        } catch (error) {
            console.error('Error saving entries:', error);
        }
    }

    // Display all entries grouped by date
    function displayAllEntries() {
        entriesList.innerHTML = '';
        // Sort by newest first (reverse chronological)
        journalEntries.sort((a, b) => new Date(b.date) - new Date(a.date)).forEach(entry => {
            const dateGroup = getOrCreateDateGroup(entry.date);
            const entryElement = createEntryElement(entry.content, entry.date, entry.images);
            dateGroup.insertBefore(entryElement, dateGroup.firstChild);
        });
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
                    <span class="material-icons-outlined">calendar_today</span>
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
            
            submitButton.onclick = () => {
                // Create date with local timezone
                const [year, month, day] = dateInput.value.split('-').map(Number);
                const newDate = new Date(year, month - 1, day); // month is 0-based in Date constructor
                const [newHours, newMinutes] = timeInput.value.split(':');
                newDate.setHours(parseInt(newHours), parseInt(newMinutes), 0, 0); // Reset seconds and milliseconds
                
                const newGroup = getOrCreateDateGroup(newDate);
                const oldGroup = entry.closest('.date-group');
                
                // Get the entry's content and current date/time for matching
                const entryContent = entry.querySelector('.entry-content').textContent;
                
                // Find and update the entry in journalEntries array
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
                    // Update the entry with the new date
                    journalEntries[entryIndex] = {
                        ...journalEntries[entryIndex],
                        date: newDate
                    };
                    
                    // Save to localStorage immediately
                    saveEntries();
                    
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
                } else {
                    console.error('Failed to find entry to update:', {
                        content: entryContent,
                        displayedTime: entry.querySelector('.entry-time').textContent,
                        displayedDate: oldGroup.dataset.date,
                        entries: journalEntries.map(e => ({
                            content: e.content,
                            time: new Date(e.date).toLocaleTimeString('en-US', {
                                hour: 'numeric',
                                minute: '2-digit',
                                hour12: true
                            }),
                            date: new Date(e.date).toLocaleDateString('en-US', {
                                year: 'numeric',
                                month: '2-digit',
                                day: '2-digit'
                            })
                        }))
                    });
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

        saveEdit.onclick = () => {
            const newContent = editArea.querySelector('textarea').value.trim();
            if (newContent || editImages.length > 0) {
                // Update content
                contentDiv.textContent = newContent;

                // Update images
                const oldImagesDiv = entry.querySelector('.entry-images');
                if (oldImagesDiv) {
                    oldImagesDiv.remove();
                }

                if (editImages.length > 0) {
                    const imagesDiv = document.createElement('div');
                    imagesDiv.className = 'entry-images';
                    
                    editImages.forEach(imgData => {
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

                // Update the entry in journalEntries
                const timeElement = entry.querySelector('.entry-time');
                const dateGroup = entry.closest('.date-group');
                const entryDate = new Date(dateGroup.dataset.date);
                
                // Set the time from the time element
                if (timeElement) {
                    const [time, period] = timeElement.textContent.split(' ');
                    const [hours, minutes] = time.split(':');
                    let hour = parseInt(hours);
                    
                    if (period === 'PM' && hour !== 12) hour += 12;
                    if (period === 'AM' && hour === 12) hour = 0;
                    
                    entryDate.setHours(hour);
                    entryDate.setMinutes(parseInt(minutes));
                }
                
                // Find and update the entry
                const entryIndex = journalEntries.findIndex(e => {
                    const eDate = new Date(e.date);
                    return eDate.getTime() === entryDate.getTime() && e.content === content;
                });
                
                if (entryIndex !== -1) {
                    journalEntries[entryIndex] = {
                        ...journalEntries[entryIndex],
                        content: newContent,
                        images: editImages
                    };
                    saveEntries();
                }

                entry.classList.remove('editing');
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

    function saveEntry() {
        const content = entryInput.value.trim();
        if (!content && images.length === 0) return;

        const newEntry = {
            content,
            date: new Date(),
            images: [...images]
        };

        journalEntries.unshift(newEntry);
        saveEntries();

        const entry = createEntryElement(content, newEntry.date, newEntry.images);
        const dateGroup = getOrCreateDateGroup(newEntry.date);
        
        // Animate the entry addition
        entry.style.opacity = '0';
        entry.style.transform = 'translateY(20px)';
        dateGroup.insertBefore(entry, dateGroup.firstChild);
        
        // Trigger reflow
        entry.offsetHeight;
        
        // Add transition class and animate in
        entry.style.transition = 'all 0.3s ease';
        entry.style.opacity = '1';
        entry.style.transform = 'translateY(0)';

        // Clear everything
        entryInput.value = '';
        images = [];
        imagePreviewContainer.innerHTML = '';
        updateProgress();
        
        // Set new random prompt
        setRandomPrompt();
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
    function deleteEntry(entry) {
        const dateGroup = entry.closest('.date-group');
        const content = entry.querySelector('.entry-content').textContent;
        const timeElement = entry.querySelector('.entry-time');
        const currentDate = new Date(dateGroup.dataset.date);
        
        // Set the time from the time element
        if (timeElement) {
            const [time, period] = timeElement.textContent.split(' ');
            const [hours, minutes] = time.split(':');
            let hour = parseInt(hours);
            
            // Convert to 24-hour format
            if (period === 'PM' && hour !== 12) hour += 12;
            if (period === 'AM' && hour === 12) hour = 0;
            
            currentDate.setHours(hour);
            currentDate.setMinutes(parseInt(minutes));
        }

        // Find the entry to delete by comparing content and approximate time
        const entryIndex = journalEntries.findIndex(e => {
            // First compare content as it's more unique
            if (e.content !== content) return false;
            
            // Then compare the displayed time with the stored time
            const eDate = new Date(e.date);
            const eTime = eDate.toLocaleTimeString('en-US', {
                hour: 'numeric',
                minute: '2-digit',
                hour12: true
            });
            const displayedTime = timeElement.textContent;
            
            // Also compare the dates (ignoring time)
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
            // Remove the entry from the array
            journalEntries.splice(entryIndex, 1);
            
            // Save to localStorage
            saveEntries();
            
            // Remove from DOM
            entry.remove();
            
            // Clean up the specific date group if it's now empty
            if (!dateGroup.querySelector('.date-group-entries').hasChildNodes()) {
                dateGroup.remove();
            }
        } else {
            console.error('Failed to find entry to delete:', {
                content,
                displayedTime: timeElement.textContent,
                displayedDate: dateGroup.dataset.date,
                entries: journalEntries.map(e => ({
                    content: e.content,
                    time: new Date(e.date).toLocaleTimeString('en-US', {
                        hour: 'numeric',
                        minute: '2-digit',
                        hour12: true
                    }),
                    date: new Date(e.date).toLocaleDateString('en-US', {
                        year: 'numeric',
                        month: '2-digit',
                        day: '2-digit'
                    })
                }))
            });
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
}); 