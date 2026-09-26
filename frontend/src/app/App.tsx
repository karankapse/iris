import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { MainScreen } from '../modules/voice-ui/screens/MainScreen';
import { PartnerView } from '../modules/voice-ui/screens/PartnerView';
import { getServices } from './services';

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<MainScreen services={getServices()} />} />
        <Route path="/partner" element={<PartnerView />} />
      </Routes>
    </BrowserRouter>
  );
}
