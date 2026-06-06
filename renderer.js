const treeRoot = document.getElementById('tree-root');
const currentPathDisplay = document.getElementById('current-path');
const btnGoUp = document.getElementById('btn-go-up');
const btnGoHome = document.getElementById('btn-go-home');
const globalSearch = document.getElementById('global-search');
const extensionFilter = document.getElementById('extension-filter');
const searchContentToggle = document.getElementById('search-content-toggle');
const searchResultsContainer = document.getElementById('search-results-container');
const searchResultsList = document.getElementById('search-results-list');
const emptyState = document.getElementById('empty-state');

let activePane = 'left'; // 'left' or 'right'
let leftDirectory = '';
let rightDirectory = '';

let currentDirectory = '';
let defaultDirectory = '';
let feedsDirectory = '';
let currentSearchScope = null; // The path currently being searched

// File management state
let selectedItemPath = null;
let clipboardPath = null;
let clipboardOperation = null; // 'copy' or 'move'

// Icons (SVG strings)
const folderIcon = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>`;
const fileIcon = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>`;
const chevronRight = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>`;
const searchIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>`;

async function init() {
    defaultDirectory = await window.electronAPI.getDefaultDir();
    feedsDirectory = await window.electronAPI.getFeedsDir();

    // Migrate generatedFeeds paths in localStorage if they point to the old directory
    generatedFeeds = generatedFeeds.map(feedPath => {
        if (feedPath.startsWith(defaultDirectory) && !feedPath.includes('/feeds/')) {
            const cleanName = feedPath.split('/').pop();
            return feedsDirectory + '/' + cleanName;
        }
        return feedPath;
    });
    localStorage.setItem('generatedFeeds', JSON.stringify(generatedFeeds));

    leftDirectory = defaultDirectory;
    rightDirectory = defaultDirectory;
    await loadDirectory(defaultDirectory, 'left');

    btnGoUp.addEventListener('click', navigateUp);
    btnGoHome.addEventListener('click', () => loadDirectory(defaultDirectory, activePane));

    const btnToggleSplit = document.getElementById('btn-toggle-split');
    if (btnToggleSplit) {
        btnToggleSplit.addEventListener('click', toggleSplitPane);
    }

    document.getElementById('pane-files-left').addEventListener('click', (e) => {
        if (!e.target.closest('.tree-row')) {
            setActivePane('left');
        }
    });
    document.getElementById('pane-files-right').addEventListener('click', (e) => {
        if (!e.target.closest('.tree-row')) {
            setActivePane('right');
        }
    });
    
    // Global search input handling
    globalSearch.addEventListener('keydown', async (e) => {
        if (e.key === 'Enter' && currentSearchScope && globalSearch.value.trim().length > 0) {
            await performSearch(currentSearchScope, globalSearch.value.trim(), extensionFilter.value.trim(), searchContentToggle.checked);
        }
    });
    // Let Enter on the extension filter textbook also trigger search
    extensionFilter.addEventListener('keydown', async (e) => {
        if (e.key === 'Enter' && currentSearchScope && globalSearch.value.trim().length > 0) {
            await performSearch(currentSearchScope, globalSearch.value.trim(), extensionFilter.value.trim(), searchContentToggle.checked);
        }
    });

    // Handle global native Native system file drops on the app or window
    document.body.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
    });
    
    document.body.addEventListener('drop', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        // Native OS file drop (copied from Finder)
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
           const sourcePath = e.dataTransfer.files[0].path;
           const targetDir = activePane === 'left' ? leftDirectory : rightDirectory;
           // If dropped anywhere in app, copy into current directory
           if (targetDir) {
               await window.electronAPI.fsCopy(sourcePath, targetDir);
               await loadDirectory(targetDir, activePane); // Refresh UI
           }
        }
    });

    // Keyboard Shortcuts (Cmd+C, Cmd+X, Cmd+V)
    window.addEventListener('keydown', async (e) => {
        const meta = e.metaKey || e.ctrlKey;
        if (!meta) return;

        if (e.key === 'c' && selectedItemPath) {
            clipboardPath = selectedItemPath;
            clipboardOperation = 'copy';
            updateClipboardVisuals();
        } else if (e.key === 'x' && selectedItemPath) {
            clipboardPath = selectedItemPath;
            clipboardOperation = 'move';
            updateClipboardVisuals();
        } else if (e.key === 'v' && clipboardPath) {
            const targetDir = activePane === 'left' ? leftDirectory : rightDirectory;
            if (targetDir) {
                // Paste into the currently open base directory
                if (clipboardOperation === 'copy') {
                    await window.electronAPI.fsCopy(clipboardPath, targetDir);
                } else if (clipboardOperation === 'move') {
                    await window.electronAPI.fsMove(clipboardPath, targetDir);
                    clipboardPath = null; // clear after move
                    clipboardOperation = null;
                }
                updateClipboardVisuals();
                await loadDirectory(targetDir, activePane);
            }
        }
    });

    // File Preview action buttons
    const previewBtnReveal = document.getElementById('preview-btn-reveal');
    const previewBtnDelete = document.getElementById('preview-btn-delete');

    if (previewBtnReveal) {
        previewBtnReveal.addEventListener('click', async () => {
            if (selectedItemPath) {
                await window.electronAPI.fsReveal(selectedItemPath);
            }
        });
    }

    if (previewBtnDelete) {
        previewBtnDelete.addEventListener('click', async () => {
            if (selectedItemPath) {
                const filename = selectedItemPath.split('/').pop();
                const confirmDel = confirm(`Are you sure you want to permanently delete "${filename}"?`);
                if (confirmDel) {
                    const res = await window.electronAPI.fsDelete(selectedItemPath);
                    if (res.success) {
                        document.getElementById('file-preview-container').classList.add('hidden');
                        document.getElementById('empty-state').classList.remove('hidden');
                        selectedItemPath = null;
                        await loadDirectory(currentDirectory, activePane);
                    } else {
                        alert(`Failed to delete file: ${res.error}`);
                    }
                }
            }
        });
    }
}

function updateClipboardVisuals() {
    document.querySelectorAll('.tree-row').forEach(row => {
        row.classList.remove('cut-pending');
        if (clipboardOperation === 'move' && row.dataset.path === clipboardPath) {
            row.classList.add('cut-pending');
        }
    });
}

// Navigates the main tree to a specific directory path entirely
async function loadDirectory(dirPath, pane = activePane) {
    if (pane === 'left') {
        leftDirectory = dirPath;
        const displayPath = document.getElementById('pane-path-left');
        if (displayPath) displayPath.textContent = dirPath;
        if (activePane === 'left') {
            currentDirectory = dirPath;
            currentSearchScope = dirPath;
            currentPathDisplay.textContent = dirPath;
            const folderName = dirPath.split('/').pop() || '/';
            globalSearch.placeholder = `Search in ${folderName}...`;
        }
        const result = await window.electronAPI.readDir(dirPath);
        if (result.success) {
            treeRoot.innerHTML = '';
            treeRoot.classList.add('expanded');
            renderTreeNodes(result.data, treeRoot, 1, false, 'left');
        } else {
            console.error("Failed to load directory left:", result.error);
        }
    } else {
        rightDirectory = dirPath;
        const displayPath = document.getElementById('pane-path-right');
        if (displayPath) displayPath.textContent = dirPath;
        if (activePane === 'right') {
            currentDirectory = dirPath;
            currentSearchScope = dirPath;
            currentPathDisplay.textContent = dirPath;
            const folderName = dirPath.split('/').pop() || '/';
            globalSearch.placeholder = `Search in ${folderName}...`;
        }
        const result = await window.electronAPI.readDir(dirPath);
        if (result.success) {
            const treeRoot2 = document.getElementById('tree-root-2');
            if (treeRoot2) {
                treeRoot2.innerHTML = '';
                treeRoot2.classList.add('expanded');
                renderTreeNodes(result.data, treeRoot2, 1, false, 'right');
            }
        } else {
            console.error("Failed to load directory right:", result.error);
        }
    }
}

// Navigates up one level from the current base directory
async function navigateUp() {
    const dirToNavigate = activePane === 'left' ? leftDirectory : rightDirectory;
    const parts = dirToNavigate.split('/');
    if (parts.length > 2) { // Need to have at least /something/something
        parts.pop();
        const newPath = parts.join('/') || '/'; // Handle root
        await loadDirectory(newPath, activePane);
    }
}

// Build DOM for entries
function renderTreeNodes(entries, parentContainer, depth = 1, preloadedChildren = false, pane = activePane) {
    // Sort entries so directories are top
    entries.sort((a, b) => {
        if (a.isDirectory && !b.isDirectory) return -1;
        if (!a.isDirectory && b.isDirectory) return 1;
        return a.name.localeCompare(b.name);
    });

    entries.forEach(entry => {
        const itemContainer = document.createElement('div');
        itemContainer.className = 'tree-item';
        
        const row = document.createElement('div');
        row.className = 'tree-row';
        row.dataset.path = entry.path;
        row.style.paddingLeft = `${depth * 16}px`;
        
        // Selection Logic
        row.addEventListener('click', (e) => {
            // Don't override if clicking chevron or search btn directly
            if (e.target.closest('.search-within-btn') || e.target.closest('.chevron')) return;
            
            setActivePane(pane);
            document.querySelectorAll('.tree-row').forEach(r => r.classList.remove('selected'));
            row.classList.add('selected');
            selectedItemPath = entry.path;
            
            if (entry.isDirectory) {
                updateSelectedFolder(entry.path);
                // Folder selection hides preview panel
                document.getElementById('file-preview-container').classList.add('hidden');
                document.getElementById('empty-state').classList.remove('hidden');
                document.getElementById('empty-state').querySelector('p').textContent = `Folder Selected: ${entry.name}. Search or expand items to navigate.`;
            } else {
                previewFile(entry.path);
            }
        });

        // Context Menu Right Click Logic
        row.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            
            setActivePane(pane);
            document.querySelectorAll('.tree-row').forEach(r => r.classList.remove('selected'));
            row.classList.add('selected');
            selectedItemPath = entry.path;
            
            if (entry.isDirectory) {
                updateSelectedFolder(entry.path);
                document.getElementById('file-preview-container').classList.add('hidden');
                document.getElementById('empty-state').classList.remove('hidden');
            } else {
                previewFile(entry.path);
            }
            
            showContextMenu(e.clientX, e.clientY, entry.path, entry.isDirectory);
        });

        // Drag and Drop (Start dragging from inside app)
        row.draggable = true;
        row.addEventListener('dragstart', (e) => {
            e.stopPropagation();
            e.dataTransfer.setData('text/plain', entry.path);
            e.dataTransfer.effectAllowed = 'copyMove';
            
            // Set selection on drag
            setActivePane(pane);
            document.querySelectorAll('.tree-row').forEach(r => r.classList.remove('selected'));
            row.classList.add('selected');
            selectedItemPath = entry.path;
            
            if (entry.isDirectory) {
                updateSelectedFolder(entry.path);
            } else {
                previewFile(entry.path);
            }
        });

        // Hover styling & drop targets (only drop onto folders)
        if (entry.isDirectory) {
            row.addEventListener('dragover', (e) => {
                e.preventDefault(); // necessary to allow drop
                e.stopPropagation();
                e.dataTransfer.dropEffect = e.altKey ? 'copy' : 'move'; // default move
                row.classList.add('drag-over');
            });

            row.addEventListener('dragleave', (e) => {
                e.preventDefault();
                row.classList.remove('drag-over');
            });

            row.addEventListener('drop', async (e) => {
                e.preventDefault();
                e.stopPropagation();
                row.classList.remove('drag-over');

                const targetFolder = entry.path;
                let sourcePath = null;
                let operation = e.altKey ? 'copy' : 'move'; // default strictly internal moves as 'move'
                
                // If native OS drop
                if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                    sourcePath = e.dataTransfer.files[0].path;
                    operation = 'copy'; // Always copy from native OS OS desktop
                } else {
                    // Internal drag
                    sourcePath = e.dataTransfer.getData('text/plain');
                }

                if (sourcePath && sourcePath !== targetFolder) {
                    if (operation === 'copy') {
                        await window.electronAPI.fsCopy(sourcePath, targetFolder);
                    } else {
                        await window.electronAPI.fsMove(sourcePath, targetFolder);
                    }
                    // Trigger a refresh
                    if (!preloadedChildren && window.electronAPI) {
                        await loadDirectory(pane === 'left' ? leftDirectory : rightDirectory, pane);
                    }
                }
            });
        }
        
        // Chevron
        const chevron = document.createElement('div');
        chevron.className = `chevron ${entry.isDirectory ? '' : 'hidden-chevron'}`;
        chevron.innerHTML = chevronRight;
        
        // Icon
        const icon = document.createElement('div');
        icon.className = `item-icon ${entry.isDirectory ? 'folder' : 'file'}`;
        icon.innerHTML = entry.isDirectory ? folderIcon : fileIcon;
        
        // Context/Match styling
        let displayName = entry.name;
        if (entry.matchType === 'parent_link') {
           displayName = entry.name + ' (Path Node)';
           row.style.opacity = '0.7';
        }
        
        // Name
        const name = document.createElement('div');
        name.className = 'item-name';
        name.textContent = displayName;
        
        row.appendChild(chevron);
        row.appendChild(icon);
        row.appendChild(name);
        
        // Set as Directory Root Button
        const drillBtn = document.createElement('button');
        drillBtn.className = 'search-within-btn';
        // Top Emoji instead of 1
        drillBtn.innerHTML = `<span style="font-size: 12px; line-height: 1;">🔝</span>`;
        drillBtn.title = entry.isDirectory ? `Set ${entry.name} as active directory` : `Go to folder containing this file`;
        drillBtn.onclick = async (e) => {
            e.stopPropagation();
            const targetPath = entry.isDirectory ? entry.path : entry.path.substring(0, entry.path.lastIndexOf('/'));
            if (targetPath) {
                // If it was clicked from a search result, jumping clears the search inherently
                emptyState.classList.remove('hidden');
                searchResultsContainer.classList.add('hidden');
                await loadDirectory(targetPath, pane);
            }
        };
        
        row.appendChild(drillBtn);

        // Search Within Button (only for folders and non-search-result trees)
        if (entry.isDirectory && !preloadedChildren) {
            const searchBtn = document.createElement('button');
            searchBtn.className = 'search-within-btn';
            searchBtn.innerHTML = searchIcon;
            searchBtn.title = `Search within ${entry.name}`;
            searchBtn.onclick = (e) => {
                e.stopPropagation();
                initiateSearch(entry.path, entry.name);
            };
            row.appendChild(searchBtn);
        }
        
        itemContainer.appendChild(row);

        // Context Blocks for full-text matches
        if (entry.context && entry.context.length > 0) {
            const contextContainer = document.createElement('div');
            contextContainer.className = 'search-context-block';
            contextContainer.style.paddingLeft = `${(depth * 16) + 32}px`;
            
            entry.context.forEach(ctxLine => {
                const pre = document.createElement('pre');
                pre.className = `context-line ${ctxLine.isContext ? 'is-context' : 'is-match'}`;
                pre.textContent = `${ctxLine.num}: ${ctxLine.text}`;
                contextContainer.appendChild(pre);
            });
            itemContainer.appendChild(contextContainer);
        }
        
        // Sub-container for children
        const childrenContainer = document.createElement('div');
        childrenContainer.className = 'tree-children';
        itemContainer.appendChild(childrenContainer);
        
        // Interaction
        if (entry.isDirectory) {
            // If it's a preloaded search result, just append the children immediately.
            if (preloadedChildren && entry.children && entry.children.length > 0) {
                renderTreeNodes(entry.children, childrenContainer, depth + 1, true, pane);
                // Autodefault expanded if preloaded
                childrenContainer.classList.add('expanded');
                chevron.classList.add('expanded');
            }

            row.addEventListener('click', async (e) => {
                if (e.target.closest('.search-within-btn') || e.target.closest('.chevron')) {
                    // Just expand/collapse logic
                } else {
                   // Selection logic is handled globally for row
                }

                const isExpanded = childrenContainer.classList.contains('expanded');
                
                if (isExpanded) {
                    childrenContainer.classList.remove('expanded');
                    chevron.classList.remove('expanded');
                } else {
                    // Lazy Loading for standard file explorer
                    if (!preloadedChildren && childrenContainer.childElementCount === 0) {
                        const res = await window.electronAPI.readDir(entry.path);
                        if(res.success) {
                            renderTreeNodes(res.data, childrenContainer, depth + 1, false, pane);
                        }
                    }
                    childrenContainer.classList.add('expanded');
                    chevron.classList.add('expanded');
                }
            });
        }
        
        parentContainer.appendChild(itemContainer);
    });
}

function initiateSearch(path, folderName) {
    currentSearchScope = path;
    globalSearch.disabled = false;
    extensionFilter.disabled = false;
    globalSearch.placeholder = `Search in ${folderName}...`;
    globalSearch.focus();
}

async function performSearch(path, query, ext, searchContent) {
    emptyState.classList.add('hidden');
    searchResultsContainer.classList.remove('hidden');
    searchResultsList.innerHTML = '<li style="color: var(--text-secondary); padding: 12px;">Searching...</li>';
    
    const result = await window.electronAPI.searchDir(path, query, ext, searchContent);
    
    searchResultsList.innerHTML = ''; // clear loading
    
    if (result.success) {
        if (result.data.length === 0) {
            searchResultsList.innerHTML = '<li style="color: var(--text-secondary); padding: 12px;">No results found.</li>';
            return;
        }
        
        // Convert flat array of search results to nested tree structure
        const nodesMap = new Map();
        
        result.data.forEach(item => {
           nodesMap.set(item.path, { ...item, children: [] });
        });
        
        const tree = [];
        
        nodesMap.forEach(node => {
           // Basic string match for unix paths.
           const lastSlash = node.path.lastIndexOf('/');
           if (lastSlash > -1) {
               const parentPath = node.path.substring(0, lastSlash);
               
               // If the parent path exists in our map, this is a child
               if (nodesMap.has(parentPath)) {
                   nodesMap.get(parentPath).children.push(node);
               } else {
                   // This is a top-level result (parent isn't in scope of results)
                   tree.push(node);
               }
           } else {
               tree.push(node);
           }
        });
        
        // Render tree using the same function, but in the search-results-container
        // We override the container to not use UL anymore.
        searchResultsList.style.display = 'block'; 
        searchResultsList.innerHTML = ''; // Ensure cleared
        
        const wrapper = document.createElement('div');
        renderTreeNodes(tree, wrapper, 0, true, activePane);
        searchResultsList.appendChild(wrapper);
        
    } else {
        searchResultsList.innerHTML = `<li style="color: #ef4444; padding: 12px;">Error: ${result.error}</li>`;
    }
}

// =========================================================================
// RSS Reader & Torrent Manager Frontend Integration
// =========================================================================
let selectedFolderForTorrent = '';
let torrentStatsInterval = null;
let rssRefreshInterval = null;

// Settings state
let rssIntervalVal = localStorage.getItem('settings-rss-interval') || '60000';
let maxConnsVal = localStorage.getItem('settings-max-conns') || '55';

// RSS state
let subscribedFeeds = JSON.parse(localStorage.getItem('subscribedFeeds') || '[]');
let generatedFeeds = JSON.parse(localStorage.getItem('generatedFeeds') || '[]');
let activeFeedUrl = '';

function initRssAndTorrent() {
    // Tab switches
    const tabFiles = document.getElementById('tab-files');
    const tabRss = document.getElementById('tab-rss');
    const tabTorrent = document.getElementById('tab-torrent');
    const tabSettings = document.getElementById('tab-settings');
    
    const panelFiles = document.getElementById('panel-files');
    const panelRss = document.getElementById('panel-rss');
    const panelTorrent = document.getElementById('panel-torrent');
    const panelSettings = document.getElementById('panel-settings');
    
    const sectionFiles = document.getElementById('section-files');
    const sectionRss = document.getElementById('section-rss');
    const sectionTorrent = document.getElementById('section-torrent');
    const sectionSettings = document.getElementById('section-settings');
    
    // Apply initial torrent settings on launch
    window.electronAPI.updateTorrentSettings({ maxConns: maxConnsVal });
    
    function switchTab(tabId) {
        [tabFiles, tabRss, tabTorrent, tabSettings].forEach(b => b.classList.remove('active'));
        [panelFiles, panelRss, panelTorrent, panelSettings].forEach(p => p.classList.add('hidden'));
        [sectionFiles, sectionRss, sectionTorrent, sectionSettings].forEach(s => s.classList.add('hidden'));
        
        clearInterval(torrentStatsInterval);
        clearInterval(rssRefreshInterval);
        
        if (tabId === 'files') {
            tabFiles.classList.add('active');
            panelFiles.classList.remove('hidden');
            sectionFiles.classList.remove('hidden');
        } else if (tabId === 'rss') {
            tabRss.classList.add('active');
            panelRss.classList.remove('hidden');
            sectionRss.classList.remove('hidden');
            loadRemoteFeedsList();
            loadLocalFeedsList();
            updateRssPublishSelect();
            startRssRefresh();
        } else if (tabId === 'torrent') {
            tabTorrent.classList.add('active');
            panelTorrent.classList.remove('hidden');
            sectionTorrent.classList.remove('hidden');
            loadActiveTorrents();
            torrentStatsInterval = setInterval(loadActiveTorrents, 1500);
        } else if (tabId === 'settings') {
            tabSettings.classList.add('active');
            panelSettings.classList.remove('hidden');
            sectionSettings.classList.remove('hidden');
            
            document.getElementById('settings-rss-interval').value = rssIntervalVal;
            document.getElementById('settings-max-conns').value = maxConnsVal;
            
            const gitSyncCheckbox = document.getElementById('settings-git-sync');
            if (gitSyncCheckbox) {
                gitSyncCheckbox.checked = localStorage.getItem('settings-git-sync') === 'true';
            }
        }
    }
    
    function startRssRefresh() {
        clearInterval(rssRefreshInterval);
        const interval = parseInt(rssIntervalVal, 10);
        if (interval > 0) {
            rssRefreshInterval = setInterval(() => {
                if (activeFeedUrl) {
                    readFeed(activeFeedUrl, true); // quiet refresh
                }
            }, interval);
        }
    }
    
    tabFiles.addEventListener('click', () => switchTab('files'));
    tabRss.addEventListener('click', () => switchTab('rss'));
    tabTorrent.addEventListener('click', () => switchTab('torrent'));
    tabSettings.addEventListener('click', () => switchTab('settings'));
    
    // RSS Reader form handlers
    const btnAddRss = document.getElementById('btn-add-rss');
    const rssFeedInput = document.getElementById('rss-feed-input');
    
    btnAddRss.addEventListener('click', () => {
        const url = rssFeedInput.value.trim();
        if (url) {
            if (!subscribedFeeds.includes(url)) {
                subscribedFeeds.push(url);
                localStorage.setItem('subscribedFeeds', JSON.stringify(subscribedFeeds));
            }
            loadRemoteFeedsList();
            readFeed(url);
            rssFeedInput.value = '';
        }
    });
    
    rssFeedInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            btnAddRss.click();
        }
    });
    
    // RSS Generated Feeds handlers
    const btnCreateRssFeed = document.getElementById('btn-create-rss-feed');
    const rssLocalName = document.getElementById('rss-local-name');
    
    btnCreateRssFeed.addEventListener('click', () => {
        const name = rssLocalName.value.trim().replace(/[^a-zA-Z0-9_-]/g, '');
        if (name) {
            const feedPath = feedsDirectory + '/' + name + '.xml';
            if (!generatedFeeds.includes(feedPath)) {
                generatedFeeds.push(feedPath);
                localStorage.setItem('generatedFeeds', JSON.stringify(generatedFeeds));
            }
            loadLocalFeedsList();
            updateRssPublishSelect();
            readFeed('file://' + feedPath);
            rssLocalName.value = '';
        }
    });
    
    rssLocalName.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            btnCreateRssFeed.click();
        }
    });
    
    // RSS Publisher Form handler
    const rssBtnPublish = document.getElementById('rss-btn-publish');
    rssBtnPublish.addEventListener('click', async () => {
        const selectFeed = document.getElementById('rss-publish-feed-select').value;
        const folderPath = document.getElementById('rss-publish-folder-path').value;
        const comment = document.getElementById('rss-publish-comment').value.trim();
        
        if (!selectFeed) {
            alert("Please select a target RSS feed file.");
            return;
        }
        if (!folderPath) {
            alert("Please select a folder in the File Explorer first.");
            return;
        }
        
        rssBtnPublish.disabled = true;
        rssBtnPublish.textContent = "Creating Torrent & Publishing...";
        
        try {
            const torrentRes = await window.electronAPI.createTorrentFromFolder(folderPath, defaultDirectory, comment);
            if (torrentRes.success) {
                const entryTitle = torrentRes.name || folderPath.split('/').pop();
                const sizeStr = formatBytes(torrentRes.sizeBytes);
                
                const publishRes = await window.electronAPI.publishRSSEntry(selectFeed, {
                    title: entryTitle,
                    comment: comment,
                    magnet: torrentRes.magnetURI,
                    date: new Date().toUTCString(),
                    size: sizeStr
                });
                
                if (publishRes.success) {
                    alert(`Successfully created torrent and published entry to RSS feed!`);
                    document.getElementById('rss-publish-comment').value = '';
                    // If we are currently reading this local feed, refresh the view
                    if (activeFeedUrl === 'file://' + selectFeed) {
                        readFeed('file://' + selectFeed);
                    }
                    
                    // Git auto-push if enabled
                    const gitSyncVal = localStorage.getItem('settings-git-sync') === 'true';
                    if (gitSyncVal) {
                        const syncRes = await window.electronAPI.gitSyncFeed(selectFeed);
                        if (syncRes.success) {
                            console.log('Git sync successful:', syncRes.stdout);
                        } else {
                            console.warn('Git sync warning:', syncRes.error);
                        }
                    }
                } else {
                    alert("Failed to publish to RSS XML: " + publishRes.error);
                }
            } else {
                alert("Failed to seed folder / create torrent: " + torrentRes.error);
            }
        } catch (err) {
            alert("An error occurred: " + err.message);
        } finally {
            rssBtnPublish.disabled = false;
            rssBtnPublish.textContent = "Publish to Feed";
        }
    });
    
    // Torrent Download handler
    const torrentBtnAdd = document.getElementById('torrent-btn-add');
    const torrentMagnetInput = document.getElementById('torrent-magnet-input');
    
    torrentBtnAdd.addEventListener('click', async () => {
        const magnet = torrentMagnetInput.value.trim();
        console.log("Add Torrent button clicked. Magnet:", magnet);
        if (magnet) {
            torrentBtnAdd.disabled = true;
            torrentBtnAdd.textContent = "Adding...";
            console.log("Calling ipcRenderer torrent-add...");
            const res = await window.electronAPI.addTorrent(magnet, defaultDirectory);
            console.log("ipcRenderer torrent-add response:", res);
            if (res.success) {
                torrentMagnetInput.value = '';
                loadActiveTorrents();
            } else {
                alert("Failed to add torrent: " + res.error);
            }
            torrentBtnAdd.disabled = false;
            torrentBtnAdd.textContent = "Add Torrent";
        }
    });
    
    torrentMagnetInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            torrentBtnAdd.click();
        }
    });
    
    // Torrent Creator handler
    const torrentBtnCreate = document.getElementById('torrent-btn-create');
    torrentBtnCreate.addEventListener('click', async () => {
        const source = document.getElementById('torrent-creator-source').value;
        const dest = document.getElementById('torrent-creator-dest').value || defaultDirectory;
        const comment = document.getElementById('torrent-creator-comment').value.trim();
        
        if (!source) {
            alert("Please select a folder in the File Explorer first.");
            return;
        }
        
        torrentBtnCreate.disabled = true;
        torrentBtnCreate.textContent = "Creating Torrent...";
        
        try {
            const res = await window.electronAPI.createTorrentFromFolder(source, dest, comment);
            if (res.success) {
                document.getElementById('torrent-creator-success').classList.remove('hidden');
                document.getElementById('feedback-torrent-file').textContent = res.torrentPath;
                document.getElementById('feedback-torrent-magnet').value = res.magnetURI;
                document.getElementById('torrent-creator-comment').value = '';
                loadActiveTorrents(); // refresh downloader list since it auto-seeds
            } else {
                alert("Failed to create torrent: " + res.error);
            }
        } catch (err) {
            alert("An error occurred: " + err.message);
        } finally {
            torrentBtnCreate.disabled = false;
            torrentBtnCreate.textContent = "Generate & Seed Torrent";
        }
    });

    // Settings form handler
    const btnSaveSettings = document.getElementById('settings-btn-save');
    if (btnSaveSettings) {
        btnSaveSettings.addEventListener('click', async () => {
            const newRssInterval = document.getElementById('settings-rss-interval').value;
            const newMaxConns = document.getElementById('settings-max-conns').value || '55';
            
            const gitSyncCheckbox = document.getElementById('settings-git-sync');
            const newGitSync = gitSyncCheckbox ? gitSyncCheckbox.checked : false;
            
            localStorage.setItem('settings-rss-interval', newRssInterval);
            localStorage.setItem('settings-max-conns', newMaxConns);
            localStorage.setItem('settings-git-sync', newGitSync ? 'true' : 'false');
            
            rssIntervalVal = newRssInterval;
            maxConnsVal = newMaxConns;
            
            // Apply new settings to main process
            const updateRes = await window.electronAPI.updateTorrentSettings({ maxConns: newMaxConns });
            
            if (updateRes.success) {
                alert('Settings saved and applied successfully!');
                // Restart refresh if we are currently on the RSS tab
                if (tabRss.classList.contains('active')) {
                    startRssRefresh();
                }
            } else {
                alert(`Failed to apply torrent settings: ${updateRes.error}`);
            }
        });
    }
}

function updateSelectedFolder(folderPath) {
    selectedFolderForTorrent = folderPath;
    const rssFolderInput = document.getElementById('rss-publish-folder-path');
    const torrentSourceInput = document.getElementById('torrent-creator-source');
    const torrentDestInput = document.getElementById('torrent-creator-dest');
    
    if (rssFolderInput) rssFolderInput.value = folderPath;
    if (torrentSourceInput) torrentSourceInput.value = folderPath;
    if (torrentDestInput) {
        const parts = folderPath.split('/');
        parts.pop();
        torrentDestInput.value = parts.join('/') || '/';
    }
}

// RSS Helper functions
function loadRemoteFeedsList() {
    const list = document.getElementById('rss-feeds-list');
    if (!list) return;
    list.innerHTML = '';
    if (subscribedFeeds.length === 0) {
        list.innerHTML = '<li style="color: var(--text-secondary); font-size: 12px; padding: 4px 10px;">No feeds subscribed.</li>';
        return;
    }
    subscribedFeeds.forEach((url, index) => {
        const li = document.createElement('li');
        li.className = 'sidebar-list-item';
        if (activeFeedUrl === url) li.classList.add('active');
        
        const cleanName = url.replace(/^https?:\/\/(www\.)?/, '').substring(0, 20) + '...';
        
        li.innerHTML = `
            <span class="feed-link-text">${cleanName}</span>
            <button class="delete-btn" data-index="${index}">&times;</button>
        `;
        
        li.querySelector('.feed-link-text').addEventListener('click', () => {
            document.querySelectorAll('.sidebar-list-item').forEach(el => el.classList.remove('active'));
            li.classList.add('active');
            readFeed(url);
        });
        
        li.querySelector('.delete-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            subscribedFeeds.splice(index, 1);
            localStorage.setItem('subscribedFeeds', JSON.stringify(subscribedFeeds));
            loadRemoteFeedsList();
            if (activeFeedUrl === url) {
                resetRssView();
            }
        });
        list.appendChild(li);
    });
}

function loadLocalFeedsList() {
    const list = document.getElementById('rss-local-list');
    if (!list) return;
    list.innerHTML = '';
    if (generatedFeeds.length === 0) {
        list.innerHTML = '<li style="color: var(--text-secondary); font-size: 12px; padding: 4px 10px;">No generated feeds.</li>';
        return;
    }
    generatedFeeds.forEach((feedPath, index) => {
        const li = document.createElement('li');
        li.className = 'sidebar-list-item';
        const url = 'file://' + feedPath;
        if (activeFeedUrl === url) li.classList.add('active');
        
        const cleanName = feedPath.split('/').pop();
        
        li.innerHTML = `
            <span class="feed-link-text" style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${cleanName}</span>
            <div style="display: flex; gap: 4px; align-items: center; flex-shrink: 0;">
                <button class="share-btn" title="Copy Share Link">🔗</button>
                <button class="delete-btn" data-index="${index}" title="Delete Feed">&times;</button>
            </div>
        `;
        
        li.querySelector('.feed-link-text').addEventListener('click', () => {
            document.querySelectorAll('.sidebar-list-item').forEach(el => el.classList.remove('active'));
            li.classList.add('active');
            readFeed(url);
        });

        li.querySelector('.share-btn').addEventListener('click', async (e) => {
            e.stopPropagation();
            try {
                const localIp = await window.electronAPI.getLocalIp();
                const publicUrl = await window.electronAPI.getPublicUrl();
                const gitInfo = await window.electronAPI.getGitRemote();
                
                let githubRawUrl = null;
                if (gitInfo && gitInfo.remoteUrl) {
                    let cleanUrl = gitInfo.remoteUrl;
                    if (cleanUrl.endsWith('.git')) {
                        cleanUrl = cleanUrl.substring(0, cleanUrl.length - 4);
                    }
                    const match = cleanUrl.match(/github\.com[:/]([^/]+)\/(.+)$/);
                    if (match) {
                        const username = match[1];
                        const repo = match[2];
                        githubRawUrl = `https://raw.githubusercontent.com/${username}/${repo}/${gitInfo.branch}/feeds/${cleanName}`;
                    }
                }
                
                const localUrl = `http://${localIp}:4122/feed/${cleanName}`;
                const localhostUrl = `http://localhost:4122/feed/${cleanName}`;
                const shareUrl = publicUrl ? `${publicUrl}/feed/${cleanName}` : null;
                
                // Prioritize githubRawUrl -> shareUrl -> localUrl
                const primaryUrl = githubRawUrl || shareUrl || localUrl;
                await navigator.clipboard.writeText(primaryUrl);
                
                let msg = `Feed Link copied to clipboard!\n\n`;
                msg += `Use this to subscribe in the app or open in your browser:\n\n`;
                
                if (githubRawUrl) {
                    msg += `• PUBLIC GITHUB RAW LINK (Highly recommended, never blocked):\n  ${githubRawUrl}\n\n`;
                } else {
                    msg += `• PUBLIC GITHUB RAW LINK:\n  (Not available - configure git origin in settings or terminal)\n\n`;
                }
                
                if (shareUrl) {
                    msg += `• PUBLIC TUNNEL LINK (Accessible worldwide):\n  ${shareUrl}\n\n`;
                } else {
                    msg += `• PUBLIC TUNNEL LINK:\n  (Connecting to public sharing server...)\n\n`;
                }
                
                msg += `• LOCAL TEST LINK (Always works on your own computer):\n  ${localhostUrl}\n\n`;
                msg += `• LOCAL NETWORK LINK (For other devices on your home WiFi):\n  ${localUrl}\n\n`;
                
                alert(msg);
            } catch (err) {
                alert(`Failed to copy feed link: ${err.message}`);
            }
        });
        
        li.querySelector('.delete-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            generatedFeeds.splice(index, 1);
            localStorage.setItem('generatedFeeds', JSON.stringify(generatedFeeds));
            loadLocalFeedsList();
            updateRssPublishSelect();
            if (activeFeedUrl === url) {
                resetRssView();
            }
        });
        list.appendChild(li);
    });
}

function updateRssPublishSelect() {
    const select = document.getElementById('rss-publish-feed-select');
    if (!select) return;
    select.innerHTML = '<option value="" disabled selected>Select generated feed...</option>';
    generatedFeeds.forEach(feedPath => {
        const opt = document.createElement('option');
        opt.value = feedPath;
        opt.textContent = feedPath.split('/').pop();
        select.appendChild(opt);
    });
}

function resetRssView() {
    activeFeedUrl = '';
    document.getElementById('rss-current-title').textContent = "RSS Feed Reader";
    document.getElementById('rss-current-desc').textContent = "Select an RSS feed from the sidebar to read articles.";
    document.getElementById('rss-articles-container').innerHTML = '';
}

async function readFeed(url, quiet = false) {
    activeFeedUrl = url;
    const container = document.getElementById('rss-articles-container');
    if (!container) return;
    if (!quiet) {
        container.innerHTML = '<div style="color: var(--text-secondary); padding: 20px;">Fetching and parsing feed...</div>';
    }
    
    try {
        const res = await window.electronAPI.fetchRSS(url);
        if (res.success) {
            document.getElementById('rss-current-title').textContent = res.title || 'Untitled Feed';
            document.getElementById('rss-current-desc').textContent = res.description || url;
            
            container.innerHTML = '';
            if (!res.items || res.items.length === 0) {
                container.innerHTML = '<div style="color: var(--text-secondary); padding: 20px;">This feed contains no items.</div>';
                return;
            }
            
            res.items.forEach(item => {
                try {
                    const card = document.createElement('div');
                    card.className = 'article-card';
                    
                    // Search for magnet links or torrent links in link/content/enclosures
                    let torrentUrl = '';
                    if (item.link && typeof item.link === 'string' && item.link.startsWith('magnet:?')) {
                        torrentUrl = item.link;
                    } else if (item.enclosure && item.enclosure.url && typeof item.enclosure.url === 'string' && (item.enclosure.url.startsWith('magnet:?') || item.enclosure.url.endsWith('.torrent'))) {
                        torrentUrl = item.enclosure.url;
                    } else if (item.content && typeof item.content === 'string') {
                        // Fallback: check content for magnet links
                        const magnetMatch = item.content.match(/href=["'](magnet:\?.*?)["']/i) || item.content.match(/(magnet:\?xt=urn:btih:[a-zA-Z0-9]+)/i);
                        if (magnetMatch) {
                            torrentUrl = magnetMatch[1];
                        }
                    }
                    
                    let cleanContent = item.content || '';
                    if (cleanContent.length > 500) {
                        cleanContent = cleanContent.substring(0, 500) + '...';
                    }
                    
                    let displayDate = 'Unknown Date';
                    if (item.pubDate) {
                        const parsedDate = new Date(item.pubDate);
                        if (!isNaN(parsedDate.getTime())) {
                            displayDate = parsedDate.toLocaleDateString();
                        }
                    }
                    
                    card.innerHTML = `
                        <div class="article-header">
                            <a href="${item.link || '#'}" target="_blank" class="article-title">${item.title || 'Untitled Article'}</a>
                            <span class="article-date">${displayDate}</span>
                        </div>
                        <div class="article-content">${cleanContent}</div>
                        <div class="article-actions hidden">
                            <button class="torrent-download-btn">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>
                                </svg>
                                ⚡ Download Torrent
                            </button>
                        </div>
                    `;
                    
                    if (torrentUrl) {
                        const actionDiv = card.querySelector('.article-actions');
                        if (actionDiv) {
                            actionDiv.classList.remove('hidden');
                            actionDiv.querySelector('.torrent-download-btn').addEventListener('click', async () => {
                                const dlBtn = actionDiv.querySelector('.torrent-download-btn');
                                dlBtn.disabled = true;
                                dlBtn.innerHTML = 'Adding...';
                                const dlRes = await window.electronAPI.addTorrent(torrentUrl, defaultDirectory);
                                if (dlRes.success) {
                                    dlBtn.innerHTML = 'Added! ⚡';
                                    dlBtn.style.backgroundColor = '#059669';
                                    setTimeout(() => {
                                        dlBtn.disabled = false;
                                        dlBtn.style.backgroundColor = '';
                                        dlBtn.innerHTML = `
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>
                                            </svg>
                                            ⚡ Download Torrent
                                        `;
                                    }, 2000);
                                } else {
                                    alert("Failed to add torrent: " + dlRes.error);
                                    dlBtn.disabled = false;
                                    dlBtn.innerHTML = '⚡ Download Torrent';
                                }
                            });
                        }
                    }
                    container.appendChild(card);
                } catch (cardErr) {
                    console.error("Error rendering RSS article card:", cardErr);
                }
            });
        } else {
            container.innerHTML = `<div style="color: #ef4444; padding: 20px;">Failed to parse RSS feed: ${res.error}</div>`;
        }
    } catch (fetchErr) {
        container.innerHTML = `<div style="color: #ef4444; padding: 20px;">An unexpected error occurred: ${fetchErr.message}</div>`;
        console.error("fetchRSS error:", fetchErr);
    }
}

// Torrent Helper functions
async function loadActiveTorrents() {
    const res = await window.electronAPI.getTorrentStatus();
    if (res.success) {
        const container = document.getElementById('torrent-list-container');
        if (!container) return;

        // Update overview mini-panel stats
        let totalDown = 0;
        let totalUp = 0;
        let activeCount = 0;
        
        res.torrents.forEach(t => {
            totalDown += t.downloadSpeed;
            totalUp += t.uploadSpeed;
            if (t.status === 'Downloading') activeCount++;
        });
        
        const activeCountEl = document.getElementById('torrent-active-count');
        const totalDownEl = document.getElementById('torrent-total-down-speed');
        const totalUpEl = document.getElementById('torrent-total-up-speed');

        if (activeCountEl) activeCountEl.textContent = activeCount;
        if (totalDownEl) totalDownEl.textContent = formatSpeed(totalDown);
        if (totalUpEl) totalUpEl.textContent = formatSpeed(totalUp);
        
        if (res.torrents.length === 0) {
            container.innerHTML = '<div style="color: var(--text-secondary); padding: 40px; text-align: center; border: 1px dashed var(--border); border-radius: 8px;">No active torrent tasks running. Add a magnet link to start!</div>';
            return;
        }
        
        container.innerHTML = '';
        res.torrents.forEach(t => {
            const percent = Math.round(t.progress * 100);
            const card = document.createElement('div');
            card.className = 'torrent-card';
            
            const isPaused = t.status === 'Paused';
            const statusClass = t.status.toLowerCase();
            
            card.innerHTML = `
                <div class="torrent-header">
                    <span class="torrent-name" title="${t.name}">${t.name}</span>
                    <div class="torrent-controls">
                        <button class="torrent-ctrl-btn pause-btn" title="${isPaused ? 'Resume Torrent' : 'Pause Torrent'}">
                            ${isPaused ? `
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <polygon points="5 3 19 12 5 21 5 3"></polygon>
                                </svg>
                            ` : `
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <rect x="6" y="4" width="4" height="16"></rect>
                                    <rect x="14" y="4" width="4" height="16"></rect>
                                </svg>
                            `}
                        </button>
                        <button class="torrent-ctrl-btn remove-btn" title="Remove Torrent">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="3 6 5 6 21 6"></polyline>
                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                            </svg>
                        </button>
                    </div>
                </div>
                
                <div class="progress-container">
                    <div class="progress-bar" style="width: ${percent}%;"></div>
                </div>
                
                <div class="torrent-meta">
                    <span class="torrent-status-badge ${statusClass}">${t.status}</span>
                    <div class="torrent-stats">
                        <span>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M12 5v14M19 12l-7 7-7-7"/>
                            </svg>
                            ${formatSpeed(t.downloadSpeed)}
                        </span>
                        <span>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M12 19V5M5 12l7-7 7 7"/>
                            </svg>
                            ${formatSpeed(t.uploadSpeed)}
                        </span>
                        <span>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 7a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm14 14v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>
                            </svg>
                            ${t.numPeers}
                        </span>
                        <span style="font-weight: 600; color: var(--text-primary); font-family: var(--font-mono); font-size: 12px;">${percent}%</span>
                    </div>
                </div>
            `;
            
            card.querySelector('.pause-btn').addEventListener('click', async () => {
                await window.electronAPI.pauseResumeTorrent(t.id);
                loadActiveTorrents();
            });
            
            card.querySelector('.remove-btn').addEventListener('click', async () => {
                const del = confirm(`Are you sure you want to stop and remove "${t.name}"?`);
                if (del) {
                    const deleteFiles = confirm("Do you also want to delete the downloaded files on disk?");
                    const rmRes = await window.electronAPI.removeTorrent(t.id, deleteFiles);
                    if (rmRes.success) {
                        loadActiveTorrents();
                    } else {
                        alert("Failed to remove torrent: " + rmRes.error);
                    }
                }
            });
            container.appendChild(card);
        });
    } else {
        console.error("Failed to get torrent status:", res.error);
        const container = document.getElementById('torrent-list-container');
        if (container) {
            container.innerHTML = `<div style="color: #ef4444; padding: 20px; text-align: center;">Error loading torrent status: ${res.error}</div>`;
        }
    }
}

// Formatting utils
function formatSpeed(bytesPerSecond) {
    if (bytesPerSecond === 0) return '0 B/s';
    const k = 1024;
    const sizes = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
    const i = Math.floor(Math.log(bytesPerSecond) / Math.log(k));
    return parseFloat((bytesPerSecond / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// =========================================================================
// File Preview & Custom Context Menu Actions
// =========================================================================
async function previewFile(filePath) {
    const filename = filePath.split('/').pop();
    document.getElementById('preview-filename').textContent = filename;
    document.getElementById('preview-filepath').textContent = filePath;
    
    const previewBody = document.getElementById('preview-body');
    previewBody.innerHTML = '<div style="color: var(--text-secondary); font-size: 13px;">Loading preview...</div>';
    
    // Toggle views
    document.getElementById('empty-state').classList.add('hidden');
    document.getElementById('search-results-container').classList.add('hidden');
    document.getElementById('file-preview-container').classList.remove('hidden');
    
    try {
        const res = await window.electronAPI.readFile(filePath);
        if (res.success) {
            if (res.isBinary) {
                // Read as base64 for safe renderer injection
                const base64Res = await window.electronAPI.readFileBase64(filePath);
                if (base64Res.success) {
                    const ext = res.ext;
                    if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.svg'].includes(ext)) {
                        let mimeType = 'image/png';
                        if (ext === '.jpg' || ext === '.jpeg') mimeType = 'image/jpeg';
                        else if (ext === '.gif') mimeType = 'image/gif';
                        else if (ext === '.webp') mimeType = 'image/webp';
                        else if (ext === '.svg') mimeType = 'image/svg+xml';
                        
                        previewBody.innerHTML = `<img class="preview-image" src="data:${mimeType};base64,${base64Res.content}" alt="${filename}">`;
                    } else if (['.mp3', '.wav', '.ogg'].includes(ext)) {
                        let mimeType = 'audio/mpeg';
                        if (ext === '.wav') mimeType = 'audio/wav';
                        else if (ext === '.ogg') mimeType = 'audio/ogg';
                        
                        previewBody.innerHTML = `<audio class="preview-audio" controls src="data:${mimeType};base64,${base64Res.content}"></audio>`;
                    } else if (['.mp4', '.webm'].includes(ext)) {
                        let mimeType = 'video/mp4';
                        if (ext === '.webm') mimeType = 'video/webm';
                        
                        previewBody.innerHTML = `<video class="preview-video" controls src="data:${mimeType};base64,${base64Res.content}"></video>`;
                    } else if (ext === '.pdf') {
                        previewBody.innerHTML = `<embed src="data:application/pdf;base64,${base64Res.content}" type="application/pdf" width="100%" height="100%" />`;
                    } else {
                        previewBody.innerHTML = `<div class="preview-error">Binary file preview not supported for extension ${ext}</div>`;
                    }
                } else {
                    previewBody.innerHTML = `<div class="preview-error">Failed to read binary file: ${base64Res.error}</div>`;
                }
            } else {
                // Text preview
                const safeContent = res.content
                    .replace(/&/g, '&amp;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;');
                previewBody.innerHTML = `<pre class="preview-text"><code>${safeContent}</code></pre>`;
            }
        } else {
            previewBody.innerHTML = `<div class="preview-error">Error loading file: ${res.error}</div>`;
        }
    } catch (err) {
        previewBody.innerHTML = `<div class="preview-error">Unexpected preview error: ${err.message}</div>`;
    }
}

const ctxMenu = document.getElementById('custom-context-menu');
const ctxReveal = document.getElementById('ctx-reveal');
const ctxRename = document.getElementById('ctx-rename');
const ctxDelete = document.getElementById('ctx-delete');

function showContextMenu(x, y, path, isDirectory) {
    ctxMenu.style.left = `${x}px`;
    ctxMenu.style.top = `${y}px`;
    ctxMenu.classList.remove('hidden');
    
    ctxReveal.onclick = async () => {
        await window.electronAPI.fsReveal(path);
        ctxMenu.classList.add('hidden');
    };
    
    ctxRename.onclick = async () => {
        ctxMenu.classList.add('hidden');
        const oldName = path.split('/').pop();
        const newName = prompt(`Enter new name for "${oldName}":`, oldName);
        if (newName && newName !== oldName) {
            const renameRes = await window.electronAPI.fsRename(path, newName);
            if (renameRes.success) {
                await loadDirectory(currentDirectory);
                if (selectedItemPath === path) {
                    selectedItemPath = renameRes.newPath;
                    if (!isDirectory) {
                        previewFile(renameRes.newPath);
                    }
                }
            } else {
                alert(`Rename failed: ${renameRes.error}`);
            }
        }
    };
    
    ctxDelete.onclick = async () => {
        ctxMenu.classList.add('hidden');
        const itemName = path.split('/').pop();
        const confirmDel = confirm(`Are you sure you want to permanently delete the ${isDirectory ? 'folder' : 'file'} "${itemName}"?`);
        if (confirmDel) {
            const deleteRes = await window.electronAPI.fsDelete(path);
            if (deleteRes.success) {
                if (selectedItemPath === path) {
                    selectedItemPath = null;
                    document.getElementById('file-preview-container').classList.add('hidden');
                    document.getElementById('empty-state').classList.remove('hidden');
                }
                await loadDirectory(currentDirectory);
            } else {
                alert(`Delete failed: ${deleteRes.error}`);
            }
        }
    };
}

// Click outside menu to close it
document.addEventListener('click', (e) => {
    if (!e.target.closest('#custom-context-menu')) {
        ctxMenu.classList.add('hidden');
    }
});

function setActivePane(pane) {
    activePane = pane;
    const paneLeft = document.getElementById('pane-files-left');
    const paneRight = document.getElementById('pane-files-right');
    
    if (pane === 'left') {
        paneLeft.classList.add('active');
        paneRight.classList.remove('active');
        currentDirectory = leftDirectory;
        currentSearchScope = leftDirectory;
        currentPathDisplay.textContent = leftDirectory;
        const folderName = leftDirectory.split('/').pop() || '/';
        globalSearch.placeholder = `Search in ${folderName}...`;
    } else {
        paneLeft.classList.remove('active');
        paneRight.classList.add('active');
        currentDirectory = rightDirectory;
        currentSearchScope = rightDirectory;
        currentPathDisplay.textContent = rightDirectory;
        const folderName = rightDirectory.split('/').pop() || '/';
        globalSearch.placeholder = `Search in ${folderName}...`;
    }
}

async function toggleSplitPane() {
    const sidebar = document.getElementById('sidebar-container');
    const rightPane = document.getElementById('pane-files-right');
    const btn = document.getElementById('btn-toggle-split');
    
    const isSplit = !rightPane.classList.contains('hidden');
    
    if (isSplit) {
        // Turn off split pane
        rightPane.classList.add('hidden');
        sidebar.style.width = '320px';
        btn.classList.remove('active');
        setActivePane('left');
    } else {
        // Turn on split pane
        rightPane.classList.remove('hidden');
        sidebar.style.width = '640px';
        btn.classList.add('active');
        
        // Ensure right pane is loaded
        if (!rightDirectory) {
            rightDirectory = defaultDirectory;
        }
        await loadDirectory(rightDirectory, 'right');
        setActivePane('left');
    }
}

// Start
init().then(() => {
    initRssAndTorrent();
});


