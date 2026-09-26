import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import './app/styles.css';

// No <StrictMode>: in development it mounts everything twice, which would open the camera twice.
createRoot(document.getElementById('root')!).render(<App />);
