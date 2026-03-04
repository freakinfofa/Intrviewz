import React, { useRef, useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Excalidraw, exportToBlob } from '@excalidraw/excalidraw';

// ── Excalidraw Wrapper Component ──
// Renders the Excalidraw canvas and exposes APIs to the parent page via window globals
function ExcalidrawWrapper({ initialData, viewMode, theme }) {
    const excalidrawRef = useRef(null);
    const [excalidrawAPI, setExcalidrawAPI] = useState(null);

    // Expose the API globally so vanilla JS can call it
    useEffect(() => {
        if (excalidrawAPI) {
            window.__excalidrawAPI = excalidrawAPI;
        }
    }, [excalidrawAPI]);

    return React.createElement(
        'div',
        { style: { width: '100%', height: '100%' } },
        React.createElement(Excalidraw, {
            ref: excalidrawRef,
            excalidrawAPI: (api) => setExcalidrawAPI(api),
            initialData: initialData || undefined,
            viewModeEnabled: viewMode || false,
            theme: theme || 'dark',
            UIOptions: {
                canvasActions: {
                    loadScene: !viewMode,
                    export: !viewMode,
                    saveAsImage: !viewMode
                }
            }
        })
    );
}

// ── Public API exposed to vanilla JS ──
window.ExcalidrawMount = {
    // Render Excalidraw into a container element
    render(containerId, options = {}) {
        const container = document.getElementById(containerId);
        if (!container) {
            console.error('Container not found:', containerId);
            return;
        }
        const root = createRoot(container);
        root.render(
            React.createElement(ExcalidrawWrapper, {
                initialData: options.initialData || null,
                viewMode: options.viewMode || false,
                theme: options.theme || 'dark'
            })
        );
        return root;
    },

    // Get the current scene data as JSON
    getSceneData() {
        const api = window.__excalidrawAPI;
        if (!api) return null;
        const elements = api.getSceneElements();
        const appState = api.getAppState();
        return {
            type: 'excalidraw',
            version: 2,
            source: 'assessment-portal',
            elements: elements,
            appState: {
                viewBackgroundColor: appState.viewBackgroundColor,
                gridSize: appState.gridSize
            }
        };
    },

    // Get scene as PNG data URL for thumbnail
    async getImageData() {
        const api = window.__excalidrawAPI;
        if (!api) return null;
        try {
            const blob = await exportToBlob({
                elements: api.getSceneElements(),
                appState: { ...api.getAppState(), exportWithDarkMode: true },
                files: api.getFiles(),
                getDimensions: () => ({ width: 800, height: 600, scale: 1 })
            });
            return new Promise((resolve) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result);
                reader.readAsDataURL(blob);
            });
        } catch (err) {
            console.error('Failed to export image:', err);
            return null;
        }
    },

    // Check if the canvas has any elements drawn
    hasContent() {
        const api = window.__excalidrawAPI;
        if (!api) return false;
        return api.getSceneElements().filter(e => !e.isDeleted).length > 0;
    }
};
