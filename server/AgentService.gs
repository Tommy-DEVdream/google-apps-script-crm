var AgentService = (function() {
  var ALLOWED_RESULTS = ['No answer', 'Cant talk', 'Order', 'Call back'];

  function getAssignedListIds(user) {
    if (user.role === CRM_CONFIG.ROLES.ADMIN) {
      return DbService.readAll('CUSTOMER_LISTS').map(function(l) { return l.listId; });
    }
    return DbService.readAll('ASSIGNMENTS')
      .filter(function(a) { return a.userId === user.userId; })
      .map(function(a) { return a.listId; });
  }

  function getAssignedCustomers(user) {
    var assignedListIds = getAssignedListIds(user);
    if (!assignedListIds.length) return [];
    var allowed = {};
    assignedListIds.forEach(function(id) { allowed[id] = true; });

    return DbService.readAll('CUSTOMERS').filter(function(c) {
      return allowed[c.listId] && DbService.normalizeBool(c.isActive);
    });
  }

  function callbackBuckets(customersById) {
    var logs = DbService.readAll('CALL_LOGS');
    var now = new Date();
    var todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var tomorrowStart = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);
    var next7Start = new Date(tomorrowStart.getTime() + 7 * 24 * 60 * 60 * 1000);

    var today = [];
    var upcoming = [];

    logs.forEach(function(log) {
      if (String(log.result) !== 'Call back') return;
      var callbackAt = DbService.parseDate(log.callbackAt);
      if (!callbackAt) return;
      var customer = customersById[log.customerId];
      if (!customer) return;

      var item = {
        customerId: customer.customerId,
        customerName: customer.customerName,
        phone: customer.phone,
        callbackAt: callbackAt.toISOString()
      };

      var ts = callbackAt.getTime();
      if (ts >= todayStart.getTime() && ts < tomorrowStart.getTime()) {
        today.push(item);
      } else if (ts >= tomorrowStart.getTime() && ts < next7Start.getTime()) {
        upcoming.push(item);
      }
    });

    today.sort(function(a, b) { return new Date(a.callbackAt) - new Date(b.callbackAt); });
    upcoming.sort(function(a, b) { return new Date(a.callbackAt) - new Date(b.callbackAt); });

    return { today: today, upcoming: upcoming };
  }

  function getState(user) {
    var assignedListIds = getAssignedListIds(user);
    var customers = getAssignedCustomers(user);
    var customersById = {};
    customers.forEach(function(c) { customersById[c.customerId] = c; });

    var buckets = callbackBuckets(customersById);

    return {
      assignedListIds: assignedListIds,
      customerIndex: customers.map(function(c) {
        return {
          customerId: c.customerId,
          customerName: c.customerName,
          phone: c.phone || ''
        };
      }),
      todayCallbacks: buckets.today,
      upcomingCallbacks: buckets.upcoming
    };
  }

  function searchCustomers(user, query) {
    var q = String(query || '').trim().toLowerCase();
    var results = getAssignedCustomers(user).filter(function(c) {
      return !q || String(c.customerName || '').toLowerCase().indexOf(q) !== -1;
    }).map(function(c) {
      return { customerId: c.customerId, customerName: c.customerName, phone: c.phone || '' };
    });

    results.sort(function(a, b) {
      return a.customerName.localeCompare(b.customerName);
    });

    return { results: results.slice(0, 200) };
  }

  function assertCustomerAssigned(user, customerId) {
    var customer = DbService.readAll('CUSTOMERS').find(function(c) { return c.customerId === customerId; });
    if (!customer) throw new Error('Customer not found.');

    var assignedIds = getAssignedListIds(user);
    if (assignedIds.indexOf(customer.listId) === -1) throw new Error('Customer not assigned to this user.');
    return customer;
  }

  function getCustomerDetail(user, customerId) {
    var customer = assertCustomerAssigned(user, customerId);

    var history = DbService.readAll('CALL_LOGS')
      .filter(function(log) { return log.customerId === customerId; })
      .map(function(log) {
        return {
          logId: log.logId,
          callAt: log.callAt,
          result: log.result,
          comment: log.comment,
          callbackAt: log.callbackAt,
          userId: log.userId
        };
      })
      .sort(function(a, b) { return new Date(b.callAt) - new Date(a.callAt); });

    return {
      customer: {
        customerId: customer.customerId,
        customerName: customer.customerName,
        phone: customer.phone,
        notes: customer.notes
      },
      history: history
    };
  }

  function addCall(user, customerId, result, comment, callbackAt) {
    assertCustomerAssigned(user, customerId);
    var safeResult = String(result || '');
    if (ALLOWED_RESULTS.indexOf(safeResult) === -1) {
      throw new Error('Invalid result.');
    }

    var safeComment = String(comment || '').trim();
    var callbackIso = '';
    if (safeResult === 'Call back') {
      var dt = DbService.parseDate(callbackAt);
      if (!dt) throw new Error('callbackAt is required when result is Call back.');
      callbackIso = dt.toISOString();
    }

    DbService.append('CALL_LOGS', {
      logId: DbService.generateId(),
      customerId: customerId,
      userId: user.userId,
      callAt: DbService.nowIso(),
      result: safeResult,
      comment: safeComment,
      callbackAt: callbackIso,
      createdAt: DbService.nowIso()
    });

    return { customerId: customerId, saved: true };
  }

  return {
    getState: getState,
    searchCustomers: searchCustomers,
    getCustomerDetail: getCustomerDetail,
    addCall: addCall
  };
})();
