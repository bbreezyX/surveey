import { mount, unmount } from 'svelte';
import App from './public/App.svelte';
import '../resources/ol.css';
import '../resources/ol-layerswitcher.css';
import '../resources/qgis2web.css';
import './public/styles/fonts.css';
import './public/styles/tokens.css';
import './public/styles/layout.css';
import './public/styles/sidebar.css';
import './public/styles/controls.css';
import './public/styles/popup.css';
import './public/styles/responsive.css';
import './public/styles/modern.css';
const target = document.getElementById('app');
if (!target) throw new Error('Application mount element is missing');
const app = mount(App, { target });
export default app;

// Production only: in dev a worker would serve stale modules over Vite's HMR.
// After `load` so registering never competes with the first render's requests.
if (import.meta.env.PROD && 'serviceWorker' in navigator) addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => undefined); });

if (import.meta.hot) import.meta.hot.dispose(() => { void unmount(app); });
