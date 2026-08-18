import { Link, Route, Routes } from 'react-router-dom';
import { Disclaimer } from './components/Disclaimer.js';
import { Dashboard } from './pages/Dashboard.js';
import { IndicatorDetail } from './pages/IndicatorDetail.js';

export function App(): JSX.Element {
  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">
      {/* O disclaimer vive no layout: aparece em todas as rotas por construcao. */}
      <Disclaimer />

      <header className="border-b border-slate-800">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
          <Link to="/" className="text-lg font-bold tracking-tight focus:outline-none focus:ring-2 focus:ring-sky-400 rounded">
            Pulse<span className="text-sky-400">FX</span>
          </Link>
          <p className="text-xs text-slate-500">BCB &middot; FRED</p>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/indicadores/:code" element={<IndicatorDetail />} />
          <Route
            path="*"
            element={<p className="text-slate-400">Pagina nao encontrada.</p>}
          />
        </Routes>
      </main>

      <footer className="border-t border-slate-800 px-4 py-6 text-center text-xs text-slate-600">
        Pulse FX &middot; dados publicos do Banco Central do Brasil e do Federal Reserve (FRED).
      </footer>
    </div>
  );
}
