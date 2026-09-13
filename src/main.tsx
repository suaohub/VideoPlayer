import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { AppFeedbackProvider } from './components/AppFeedback';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppFeedbackProvider>
      <App />
    </AppFeedbackProvider>
  </React.StrictMode>
);
