import { mount } from 'svelte';
import App from './App.svelte';
import 'ol/ol.css';
import './sheet.css';
import './admin.css';
mount(App, { target: document.getElementById('app')! });
