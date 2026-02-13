var AuthService = (function() {
  function createDefaultAdminIfMissing(username, password, role) {
    var users = DbService.readAll('USERS');
    var normalized = normalizeUsername(username);
    var found = users.some(function(u) {
      return normalizeUsername(u.username) === normalized;
    });
    if (!found) {
      var hashData = hashPassword(password);
      DbService.append('USERS', {
        userId: DbService.generateId(),
        username: username,
        passwordHash: hashData.passwordHash,
        passwordSalt: hashData.passwordSalt,
        role: role,
        isActive: true,
        createdAt: DbService.nowIso(),
        lastLoginAt: ''
      });
    }
  }

  function normalizeUsername(username) {
    return String(username || '').trim().toLowerCase();
  }

  function toHex(bytes) {
    return bytes.map(function(b) {
      var v = (b + 256) % 256;
      return ('0' + v.toString(16)).slice(-2);
    }).join('');
  }

  function hashPassword(password, salt) {
    var finalSalt = salt || Utilities.getUuid().replace(/-/g, '').slice(0, 16);
    var raw = finalSalt + '|' + String(password);
    var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, raw, Utilities.Charset.UTF_8);
    return {
      passwordSalt: finalSalt,
      passwordHash: toHex(digest)
    };
  }

  function verifyPassword(password, storedSalt, storedHash) {
    var candidate = hashPassword(password, storedSalt);
    return candidate.passwordHash === String(storedHash || '');
  }

  function getSessionTtlHours() {
    var config = DbService.readAll('CONFIG');
    var row = config.find(function(item) { return item.key === 'SESSION_TTL_HOURS'; });
    var val = row ? Number(row.value) : NaN;
    return (val && val > 0) ? val : CRM_CONFIG.SESSION_TTL_HOURS_DEFAULT;
  }

  function cleanupExpiredSessions() {
    var now = new Date();
    var sessions = DbService.readAll('SESSIONS');
    var active = sessions.filter(function(s) {
      var expires = DbService.parseDate(s.expiresAt);
      return expires && expires.getTime() > now.getTime();
    });
    if (active.length !== sessions.length) {
      DbService.replaceAll('SESSIONS', active);
    }
  }

  function login(username, password) {
    cleanupExpiredSessions();
    var normalized = normalizeUsername(username);
    var users = DbService.readAll('USERS');
    var user = users.find(function(u) {
      return normalizeUsername(u.username) === normalized;
    });

    if (!user || !DbService.normalizeBool(user.isActive)) {
      throw new Error('Invalid credentials.');
    }
    if (!verifyPassword(password, user.passwordSalt, user.passwordHash)) {
      throw new Error('Invalid credentials.');
    }

    var now = new Date();
    var ttlMs = getSessionTtlHours() * 60 * 60 * 1000;
    var session = {
      sessionId: DbService.generateId(),
      userId: user.userId,
      expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
      createdAt: now.toISOString()
    };
    DbService.append('SESSIONS', session);
    DbService.updateById('USERS', 'userId', user.userId, { lastLoginAt: now.toISOString() });

    return {
      token: session.sessionId,
      user: {
        userId: user.userId,
        username: user.username,
        role: user.role
      },
      expiresAt: session.expiresAt
    };
  }

  function requireSession(token) {
    cleanupExpiredSessions();
    if (!token) throw new Error('Session required.');

    var sessions = DbService.readAll('SESSIONS');
    var session = sessions.find(function(s) { return String(s.sessionId) === String(token); });
    if (!session) throw new Error('Session expired or invalid.');

    var users = DbService.readAll('USERS');
    var user = users.find(function(u) { return u.userId === session.userId; });
    if (!user || !DbService.normalizeBool(user.isActive)) {
      throw new Error('User inactive or missing.');
    }

    return {
      userId: user.userId,
      username: user.username,
      role: user.role
    };
  }

  function requireRole(token, role) {
    var user = requireSession(token);
    if (user.role === CRM_CONFIG.ROLES.ADMIN) return user;
    if (user.role !== role) throw new Error('Access denied.');
    return user;
  }

  function logout(token) {
    if (!token) return;
    var sessions = DbService.readAll('SESSIONS');
    var kept = sessions.filter(function(s) { return String(s.sessionId) !== String(token); });
    if (kept.length !== sessions.length) {
      DbService.replaceAll('SESSIONS', kept);
    }
  }

  return {
    createDefaultAdminIfMissing: createDefaultAdminIfMissing,
    hashPassword: hashPassword,
    normalizeUsername: normalizeUsername,
    login: login,
    requireSession: requireSession,
    requireRole: requireRole,
    logout: logout,
    cleanupExpiredSessions: cleanupExpiredSessions
  };
})();
