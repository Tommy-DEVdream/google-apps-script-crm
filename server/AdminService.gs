var AdminService = (function() {
  function getState() {
    var users = DbService.readAll('USERS').map(function(u) {
      return {
        userId: u.userId,
        username: u.username,
        role: u.role,
        isActive: DbService.normalizeBool(u.isActive),
        createdAt: u.createdAt,
        lastLoginAt: u.lastLoginAt
      };
    });

    var agents = users.filter(function(u) {
      return u.role === CRM_CONFIG.ROLES.AGENT;
    }).map(function(a) {
      return { userId: a.userId, username: a.username, isActive: a.isActive };
    });

    var lists = DbService.readAll('CUSTOMER_LISTS').map(function(l) {
      return { listId: l.listId, listName: l.listName, createdAt: l.createdAt };
    });

    lists.sort(function(a, b) {
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });

    var selectedListId = lists.length ? lists[lists.length - 1].listId : null;

    var allAssignments = DbService.readAll('ASSIGNMENTS');
    var assignmentsByUserId = {};
    agents.forEach(function(agent) {
      assignmentsByUserId[agent.userId] = [];
    });
    allAssignments.forEach(function(a) {
      if (assignmentsByUserId[a.userId]) {
        assignmentsByUserId[a.userId].push(a.listId);
      }
    });

    return {
      users: users,
      agents: agents,
      lists: lists.map(function(l) { return { listId: l.listId, listName: l.listName }; }),
      assignmentsByUserId: assignmentsByUserId,
      selectedListId: selectedListId
    };
  }

  function createUser(username, password, role) {
    var cleanUsername = String(username || '').trim();
    var cleanPassword = String(password || '');
    var cleanRole = String(role || '').trim().toUpperCase();

    if (!cleanUsername) throw new Error('Username is required.');
    if (!cleanPassword) throw new Error('Password is required.');
    if (cleanRole !== CRM_CONFIG.ROLES.ADMIN && cleanRole !== CRM_CONFIG.ROLES.AGENT) {
      throw new Error('Role must be ADMIN or AGENT.');
    }

    var users = DbService.readAll('USERS');
    var norm = AuthService.normalizeUsername(cleanUsername);
    var exists = users.some(function(u) {
      return AuthService.normalizeUsername(u.username) === norm;
    });
    if (exists) throw new Error('Username already exists.');

    var hash = AuthService.hashPassword(cleanPassword);
    var userId = DbService.generateId();
    DbService.append('USERS', {
      userId: userId,
      username: cleanUsername,
      passwordHash: hash.passwordHash,
      passwordSalt: hash.passwordSalt,
      role: cleanRole,
      isActive: true,
      createdAt: DbService.nowIso(),
      lastLoginAt: ''
    });
    return { userId: userId };
  }

  function generateTempPassword() {
    return 'Temp' + Math.floor(100000 + Math.random() * 900000);
  }

  function resetPassword(userId) {
    var users = DbService.readAll('USERS');
    var user = users.find(function(u) { return String(u.userId) === String(userId); });
    if (!user) throw new Error('User not found.');

    var tempPassword = generateTempPassword();
    var hash = AuthService.hashPassword(tempPassword);
    DbService.updateById('USERS', 'userId', userId, {
      passwordHash: hash.passwordHash,
      passwordSalt: hash.passwordSalt
    });
    return { userId: userId, tempPassword: tempPassword };
  }

  function setUserActive(userId, isActive) {
    var users = DbService.readAll('USERS');
    var user = users.find(function(u) { return String(u.userId) === String(userId); });
    if (!user) throw new Error('User not found.');

    DbService.updateById('USERS', 'userId', userId, { isActive: !!isActive });
    if (!isActive) {
      var sessions = DbService.readAll('SESSIONS').filter(function(s) { return s.userId !== userId; });
      DbService.replaceAll('SESSIONS', sessions);
    }
    return { userId: userId, isActive: !!isActive };
  }

  function createList(listName) {
    var name = String(listName || '').trim();
    if (!name) throw new Error('List name is required.');

    var lists = DbService.readAll('CUSTOMER_LISTS');
    var exists = lists.some(function(l) { return String(l.listName).toLowerCase() === name.toLowerCase(); });
    if (exists) throw new Error('A list with this name already exists.');

    var listId = DbService.generateId();
    DbService.append('CUSTOMER_LISTS', {
      listId: listId,
      listName: name,
      createdAt: DbService.nowIso()
    });
    return { listId: listId };
  }

  function normalizeCustomerName(name) {
    return String(name || '').trim().replace(/\s+/g, ' ').toLowerCase();
  }

  function parseCsvLines(csvText) {
    var text = String(csvText || '').replace(/\\n/g, '\n');
    var lines = text.split(/\r?\n/).map(function(l) { return l.trim(); }).filter(function(l) { return l; });
    return lines.map(function(line) {
      var cols = line.split(',');
      var name = String(cols[0] || '').trim();
      var phone = String(cols[1] || '').trim();
      var notes = cols.length > 2 ? cols.slice(2).join(',').trim() : '';
      return { name: name, phone: phone, notes: notes };
    });
  }

  function importCustomers(listId, csvText) {
    var list = DbService.readAll('CUSTOMER_LISTS').find(function(l) { return l.listId === listId; });
    if (!listId || !list) throw new Error('listId required and must exist.');

    var rows = parseCsvLines(csvText);
    if (!rows.length) throw new Error('No valid lines found.');

    var existing = DbService.readAll('CUSTOMERS').filter(function(c) { return c.listId === listId; });
    var existingNames = {};
    existing.forEach(function(c) {
      existingNames[normalizeCustomerName(c.customerName)] = true;
    });

    var seenInInput = {};
    var inserted = 0;
    var skipped = 0;
    var errors = 0;

    rows.forEach(function(row) {
      var normalized = normalizeCustomerName(row.name);
      if (!normalized) {
        errors++;
        return;
      }
      if (existingNames[normalized] || seenInInput[normalized]) {
        skipped++;
        return;
      }
      seenInInput[normalized] = true;
      existingNames[normalized] = true;
      DbService.append('CUSTOMERS', {
        customerId: DbService.generateId(),
        listId: listId,
        customerName: row.name.replace(/\s+/g, ' ').trim(),
        phone: row.phone,
        notes: row.notes,
        isActive: true
      });
      inserted++;
    });

    return { inserted: inserted, skipped: skipped, errors: errors };
  }

  function setAssignmentsForAgent(agentUserId, listIds) {
    var users = DbService.readAll('USERS');
    var agent = users.find(function(u) { return u.userId === agentUserId && u.role === CRM_CONFIG.ROLES.AGENT && DbService.normalizeBool(u.isActive); });
    if (!agent) throw new Error('Active AGENT not found.');

    var lists = DbService.readAll('CUSTOMER_LISTS');
    var allowed = {};
    lists.forEach(function(l) { allowed[l.listId] = true; });

    var finalListIds = Array.isArray(listIds) ? listIds : [];
    finalListIds.forEach(function(id) {
      if (!allowed[id]) throw new Error('Invalid list id in assignment payload.');
    });

    var lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      var assignments = DbService.readAll('ASSIGNMENTS').filter(function(a) { return a.userId !== agentUserId; });
      finalListIds.forEach(function(listId) {
        assignments.push({
          assignmentId: DbService.generateId(),
          userId: agentUserId,
          listId: listId,
          createdAt: DbService.nowIso()
        });
      });
      DbService.replaceAll('ASSIGNMENTS', assignments);
    } finally {
      lock.releaseLock();
    }

    return { agentUserId: agentUserId, assignedCount: finalListIds.length };
  }

  function report(dateFrom, dateTo) {
    var from = DbService.parseDate(dateFrom);
    var to = DbService.parseDate(dateTo);
    if (!from || !to) throw new Error('Valid dateFrom and dateTo are required.');

    var end = new Date(to.getTime());
    end.setHours(23, 59, 59, 999);

    var users = DbService.readAll('USERS');
    var userMap = {};
    users.forEach(function(u) { userMap[u.userId] = u.username; });

    var logs = DbService.readAll('CALL_LOGS').filter(function(log) {
      var d = DbService.parseDate(log.callAt);
      if (!d) return false;
      return d.getTime() >= from.getTime() && d.getTime() <= end.getTime();
    });

    var byAgent = {};
    logs.forEach(function(log) {
      var key = log.userId;
      if (!byAgent[key]) {
        byAgent[key] = { userId: key, username: userMap[key] || 'Unknown', calls: 0, orders: 0 };
      }
      byAgent[key].calls += 1;
      if (String(log.result) === 'Order') byAgent[key].orders += 1;
    });

    var now = new Date();
    var todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var tomorrowStart = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);
    var next7Start = new Date(tomorrowStart.getTime() + 7 * 24 * 60 * 60 * 1000);

    var callbacks = DbService.readAll('CALL_LOGS').filter(function(log) {
      return String(log.result) === 'Call back' && !!DbService.parseDate(log.callbackAt);
    });

    var dueToday = 0;
    var upcoming7Days = 0;
    callbacks.forEach(function(log) {
      var dt = DbService.parseDate(log.callbackAt);
      var ts = dt.getTime();
      if (ts >= todayStart.getTime() && ts < tomorrowStart.getTime()) {
        dueToday++;
      } else if (ts >= tomorrowStart.getTime() && ts < next7Start.getTime()) {
        upcoming7Days++;
      }
    });

    return {
      dateFrom: from.toISOString(),
      dateTo: end.toISOString(),
      byAgent: Object.keys(byAgent).map(function(k) { return byAgent[k]; }),
      callbacks: {
        dueToday: dueToday,
        upcoming7Days: upcoming7Days
      }
    };
  }

  return {
    getState: getState,
    createUser: createUser,
    resetPassword: resetPassword,
    setUserActive: setUserActive,
    createList: createList,
    importCustomers: importCustomers,
    setAssignmentsForAgent: setAssignmentsForAgent,
    report: report
  };
})();
