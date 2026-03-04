import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import * as ExcalidrawLib from '@excalidraw/excalidraw';

// Make Excalidraw available globally
if (typeof window !== 'undefined') {
    window.Excalidraw = ExcalidrawLib;
}

// Access Excalidraw from global
const getExcalidraw = () => {
    if (typeof window !== 'undefined' && window.Excalidraw) {
        return window.Excalidraw;
    }
    throw new Error('Excalidraw not loaded');
};

class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false, error: null };
    }
    static getDerivedStateFromError(error) {
        return { hasError: true, error };
    }
    componentDidCatch(error, errorInfo) {
        console.error('Excalidraw Error:', error, errorInfo);
    }
    render() {
        if (this.state.hasError) {
            return React.createElement('div', { 
                style: { padding: 20, color: 'red', background: '#300' } 
            }, 'Error loading Excalidraw: ' + (this.state.error?.message || 'Unknown error'));
        }
        return this.props.children;
    }
}

function ExcalidrawWrapper({ initialData, viewMode, theme }) {
    const [excalidrawAPI, setExcalidrawAPI] = useState(null);

    useEffect(() => {
        if (excalidrawAPI) {
            window.__excalidrawAPI = excalidrawAPI;
        }
    }, [excalidrawAPI]);

    const ExcalidrawComponent = getExcalidraw().Excalidraw;

    return React.createElement(
        ErrorBoundary,
        null,
        React.createElement(
            'div',
            { style: { width: '100%', height: '100%' } },
            React.createElement(ExcalidrawComponent, {
                excalidrawAPI: (api) => {
                    console.log('Excalidraw API received');
                    setExcalidrawAPI(api);
                },
                initialData: initialData || undefined,
                viewModeEnabled: viewMode || false,
                theme: theme || 'dark',
                UIOptions: {
                    canvasActions: {
                        loadScene: !viewMode,
                        export: {
                            saveFileToDisk: !viewMode
                        },
                        saveAsImage: !viewMode
                    }
                }
            })
        )
    );
}

console.log('Excalidraw bundle loaded at', new Date().toISOString());

let rootInstance = null;

window.ExcalidrawMount = {
    render(containerId, options = {}) {
        console.log('ExcalidrawMount.render called', containerId, options);
        const container = document.getElementById(containerId);
        if (!container) {
            console.error('Container not found:', containerId);
            return null;
        }
        console.log('Container found, innerHTML:', container.innerHTML);
        console.log('Container dimensions:', container.offsetWidth, container.offsetHeight);
        try {
            rootInstance = createRoot(container);
            console.log('Root created, about to render');
            rootInstance.render(
                React.createElement(ExcalidrawWrapper, {
                    initialData: options.initialData || null,
                    viewMode: options.viewMode || false,
                    theme: options.theme || 'dark'
                })
            );
            console.log('Render called successfully');
        } catch (e) {
            console.error('Error during render:', e);
        }
        return rootInstance;
    },

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

    async getImageData() {
        const api = window.__excalidrawAPI;
        if (!api) return null;
        try {
            const exportToBlob = getExcalidraw().exportToBlob;
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

    hasContent() {
        const api = window.__excalidrawAPI;
        if (!api) return false;
        return api.getSceneElements().filter(e => !e.isDeleted).length > 0;
    }
};
