import './styles/fonts.css';
import './styles/tokens.css';
import './styles/base.css';
import { mountDiagPage } from './diag/page';

const root = document.getElementById('app');
if (!root) throw new Error('Elemento #app mancante');
mountDiagPage(root);
