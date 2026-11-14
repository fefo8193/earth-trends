import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import AppBoundary from './components/AppBoundary.jsx';
import './styles.css';
import { initialLang, setLang } from './lib/i18n.js';

setLang(initialLang());

createRoot(document.getElementById('root')).render(<AppBoundary><App /></AppBoundary>);
