import './styles/fonts.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/app.css';
import { mountApp } from './app/app';

// Due schermate nella stessa pagina: l'app (predefinita) e la diagnostica (#diag). La diagnostica NON ha piu' una voce nel menu (decisione 131): si raggiunge solo
// scrivendo #diag nell'indirizzo. Restano entrambe montate, cosi' passare dall'una all'altra non perde il documento aperto.
const root = document.getElementById('app');
if (!root) throw new Error('Elemento #app mancante');

const appRoot = document.createElement('div');
appRoot.className = 'screen-app';
const diagRoot = document.createElement('div');
diagRoot.className = 'screen-diag';
diagRoot.hidden = true;
root.append(appRoot, diagRoot);

let diagMounted = false;
const showDiag = (on: boolean): void => {
  appRoot.hidden = on;
  diagRoot.hidden = !on;
  document.body.classList.toggle('app-mode', !on);
  if (on && !diagMounted) {
    diagMounted = true;
    void import('./diag/page').then((m) => m.mountDiagPage(diagRoot, () => (location.hash = '')));
  }
};
const route = (): void => showDiag(location.hash === '#diag');

mountApp(appRoot);
window.addEventListener('hashchange', route);
route();
