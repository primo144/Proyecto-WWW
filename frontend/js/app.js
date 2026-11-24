import { onSessionExpired } from './api.js';
import { getCurrentSession, logoutSession } from './auth.js';
import { clearNode, el, showToast } from './ui.js';
import { renderAdminView } from './views/adminView.js';
import { renderCashierView } from './views/cashierView.js';
import { renderHelpView } from './views/helpView.js';
import { renderLoginView } from './views/loginView.js';
import { renderTotemView } from './views/totemView.js';

const appRoot = document.querySelector('#app-root');
const mainNav = document.querySelector('#main-nav');
const sessionSummary = document.querySelector('#session-summary');

let currentRoute = 'login';

function getDefaultRouteForRole(role) {
  if (role === 'ADMINISTRADOR') return 'admin';
  if (role === 'CAJERO') return 'cashier';
  return 'totem';
}

function getAllowedRoutes(session) {
  if (!session) {
    return [
      { id: 'login', label: 'Ingreso / Catalogo' },
      { id: 'help', label: 'Ayuda' }
    ];
  }

  const role = session.user.role;
  const routes = [{ id: 'totem', label: 'Totem Vales' }];
  if (role === 'CAJERO') {
    routes.push({ id: 'cashier', label: 'Caja Casino' });
  }
  if (role === 'ADMINISTRADOR') {
    routes.push({ id: 'admin', label: 'Administracion' });
  }
  routes.push({ id: 'help', label: 'Ayuda' });
  return routes;
}

function renderChrome(session) {
  clearNode(mainNav);
  clearNode(sessionSummary);

  const routes = getAllowedRoutes(session);
  for (const r of routes) {
    mainNav.appendChild(
      el('button', {
        type: 'button',
        className: `btn btn-sm ${currentRoute === r.id ? 'btn-warning text-dark fw-semibold' : 'btn-outline-light'}`,
        text: r.label,
        onClick: () => navigate(r.id)
      })
    );
  }

  if (session) {
    sessionSummary.appendChild(
      el('span', {
        className: 'user-pill',
        text: `${session.user.codigoFuncionario} · ${session.user.role}`
      })
    );
    sessionSummary.appendChild(
      el('button', {
        type: 'button',
        className: 'btn btn-outline-light btn-sm',
        text: 'Cerrar Sesion',
        onClick: async () => {
          await logoutSession();
          showToast('Sesion cerrada correctamente', 'success');
          navigate('login');
        }
      })
    );
  }
}

function navigate(targetRoute) {
  const session = getCurrentSession();
  const allowed = getAllowedRoutes(session).map((r) => r.id);
  if (!allowed.includes(targetRoute)) {
    currentRoute = session ? getDefaultRouteForRole(session.user.role) : 'login';
  } else {
    currentRoute = targetRoute;
  }

  renderChrome(session);

  if (currentRoute === 'login') {
    renderLoginView(appRoot, (user) => {
      navigate(getDefaultRouteForRole(user.role));
    });
  } else if (currentRoute === 'totem') {
    renderTotemView(appRoot);
  } else if (currentRoute === 'cashier') {
    renderCashierView(appRoot);
  } else if (currentRoute === 'admin') {
    renderAdminView(appRoot);
  } else if (currentRoute === 'help') {
    renderHelpView(appRoot);
  }
}

onSessionExpired(() => {
  showToast('Su sesion expiro o fue revocada. Ingrese nuevamente.', 'error');
  navigate('login');
});

document.addEventListener('DOMContentLoaded', () => {
  const session = getCurrentSession();
  navigate(session ? getDefaultRouteForRole(session.user.role) : 'login');
});
