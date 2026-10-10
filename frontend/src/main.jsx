import React, { StrictMode } from 'react'
import ReactDOM, { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// Expose React globally for UMD CDN scripts (e.g. pydah-ai-chat-ui)
window.React = React;
window.ReactDOM = ReactDOM;

// Prevent mouse wheel from changing values on number inputs globally
document.addEventListener('wheel', function (e) {
  if (document.activeElement && document.activeElement.tagName === 'INPUT' && document.activeElement.type === 'number') {
    document.activeElement.blur();
  }
});

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

