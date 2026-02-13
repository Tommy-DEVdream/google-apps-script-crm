const CRM_CONFIG = {
  SESSION_TTL_HOURS_DEFAULT: 8,
  SESSION_STORAGE_KEY: 'crm_session',
  DEFAULT_ADMIN_USERNAME: 'Thomaz Muller',
  DEFAULT_ADMIN_PASSWORD: 'Rodmor2011@',
  DEFAULT_ADMIN_ROLE: 'ADMIN',
  ROLES: {
    ADMIN: 'ADMIN',
    AGENT: 'AGENT'
  }
};

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function doGet(e) {
  const page = (e && e.parameter && e.parameter.page) ? String(e.parameter.page).toLowerCase() : 'login';
  let file = 'ui/Login';
  let title = 'CRM Login';

  if (page === 'admin') {
    file = 'ui/Admin';
    title = 'CRM Admin';
  } else if (page === 'agent') {
    file = 'ui/Agent';
    title = 'CRM Agent';
  }

  return HtmlService.createTemplateFromFile(file)
    .evaluate()
    .setTitle(title)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function setupDatabase() {
  DbService.ensureSchema();
  AuthService.createDefaultAdminIfMissing(
    CRM_CONFIG.DEFAULT_ADMIN_USERNAME,
    CRM_CONFIG.DEFAULT_ADMIN_PASSWORD,
    CRM_CONFIG.DEFAULT_ADMIN_ROLE
  );
  return { ok: true, data: { message: 'Database initialized.' } };
}

function withApi(handler) {
  try {
    return { ok: true, data: handler() };
  } catch (err) {
    const debugId = Utilities.getUuid().slice(0, 8);
    console.error('[' + debugId + '] ' + (err && err.stack ? err.stack : err));
    return {
      ok: false,
      error: (err && err.message) ? err.message : 'Unexpected error.',
      debugId: debugId
    };
  }
}

function apiLogin(username, password) {
  return withApi(function() {
    return AuthService.login(username, password);
  });
}

function apiLogout(token) {
  return withApi(function() {
    AuthService.logout(token);
    return { loggedOut: true };
  });
}

function apiAdminGetState(token) {
  return withApi(function() {
    const user = AuthService.requireRole(token, CRM_CONFIG.ROLES.ADMIN);
    return AdminService.getState(user);
  });
}

function apiAdminCreateUser(token, username, password, role) {
  return withApi(function() {
    AuthService.requireRole(token, CRM_CONFIG.ROLES.ADMIN);
    return AdminService.createUser(username, password, role);
  });
}

function apiAdminResetPassword(token, userId) {
  return withApi(function() {
    AuthService.requireRole(token, CRM_CONFIG.ROLES.ADMIN);
    return AdminService.resetPassword(userId);
  });
}

function apiAdminSetUserActive(token, userId, isActive) {
  return withApi(function() {
    AuthService.requireRole(token, CRM_CONFIG.ROLES.ADMIN);
    return AdminService.setUserActive(userId, isActive);
  });
}

function apiAdminCreateList(token, listName) {
  return withApi(function() {
    AuthService.requireRole(token, CRM_CONFIG.ROLES.ADMIN);
    return AdminService.createList(listName);
  });
}

function apiAdminImportCustomers(token, listId, csvText) {
  return withApi(function() {
    AuthService.requireRole(token, CRM_CONFIG.ROLES.ADMIN);
    return AdminService.importCustomers(listId, csvText);
  });
}

function apiAdminSetAssignments(token, agentUserId, listIds) {
  return withApi(function() {
    AuthService.requireRole(token, CRM_CONFIG.ROLES.ADMIN);
    return AdminService.setAssignmentsForAgent(agentUserId, listIds);
  });
}

function apiAdminReport(token, dateFrom, dateTo) {
  return withApi(function() {
    AuthService.requireRole(token, CRM_CONFIG.ROLES.ADMIN);
    return AdminService.report(dateFrom, dateTo);
  });
}

function apiAgentGetState(token) {
  return withApi(function() {
    const user = AuthService.requireSession(token);
    if (user.role !== CRM_CONFIG.ROLES.ADMIN && user.role !== CRM_CONFIG.ROLES.AGENT) {
      throw new Error('Access denied.');
    }
    return AgentService.getState(user);
  });
}

function apiAgentSearch(token, query) {
  return withApi(function() {
    const user = AuthService.requireSession(token);
    if (user.role !== CRM_CONFIG.ROLES.ADMIN && user.role !== CRM_CONFIG.ROLES.AGENT) {
      throw new Error('Access denied.');
    }
    return AgentService.searchCustomers(user, query);
  });
}

function apiAgentGetCustomer(token, customerId) {
  return withApi(function() {
    const user = AuthService.requireSession(token);
    if (user.role !== CRM_CONFIG.ROLES.ADMIN && user.role !== CRM_CONFIG.ROLES.AGENT) {
      throw new Error('Access denied.');
    }
    return AgentService.getCustomerDetail(user, customerId);
  });
}

function apiAgentAddCall(token, customerId, result, comment, callbackAt) {
  return withApi(function() {
    const user = AuthService.requireSession(token);
    if (user.role !== CRM_CONFIG.ROLES.ADMIN && user.role !== CRM_CONFIG.ROLES.AGENT) {
      throw new Error('Access denied.');
    }
    return AgentService.addCall(user, customerId, result, comment, callbackAt);
  });
}
