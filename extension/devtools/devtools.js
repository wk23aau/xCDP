// DevTools page - creates the panel
chrome.devtools.panels.create(
    'ActionMap',
    '', // No icon for now
    'devtools/panel.html',
    (panel) => {
        console.log('ActionMap panel created');
    }
);
