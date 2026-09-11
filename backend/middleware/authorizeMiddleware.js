/**
 * Maps API paths to the frontend permission paths / feature flags required for access.
 * Superadmin bypasses all checks. Rules are matched longest-prefix-first.
 */
const API_ACCESS_RULES = [
  {
    prefix: '/api/reports/dashboard-stats',
    permissions: ['/dashboard'],
  },
  {
    prefix: '/api/reports/transactions',
    permissions: ['/reports', 'reports_daily_collection', 'reports_cashier_summary', 'reports_fee_head_summary', 'reports_account_wise'],
  },
  {
    prefix: '/api/reports/dues',
    permissions: ['/due-reports'],
  },
  {
    prefix: '/api/users',
    permissions: ['/user-management'],
  },
  {
    prefix: '/api/employees',
    permissions: ['/user-management'],
  },
  {
    prefix: '/api/fee-heads',
    permissions: ['/fee-config', '/fee-collection', '/concessions', '/overall-concessions', '/proceedings', 'proceedings_view', 'proceedings_edit', 'proceedings_verify', 'proceedings_approve'],
  },
  {
    prefix: '/api/fee-groups',
    permissions: ['/fee-config', '/reports', 'reports_fee_head_summary'],
  },
  {
    prefix: '/api/fee-structures',
    permissions: ['/fee-config', '/fee-collection', '/bulk-fee-upload', '/hostel-config'],
  },
  {
    prefix: '/api/late-fees',
    permissions: ['/fee-config'],
  },
  {
    prefix: '/api/bulk-fee',
    permissions: ['/bulk-fee-upload'],
  },
  {
    prefix: '/api/payment-config',
    permissions: ['/payment-config', '/fee-collection', '/proceedings', 'proceedings_view', 'proceedings_edit', 'proceedings_verify', 'proceedings_approve'],
  },
  {
    prefix: '/api/academic-calendar',
    permissions: ['/academic-calendar', '/fee-config', '/reminders'],
  },
  {
    prefix: '/api/concession-approvers',
    permissions: ['/fee-collection', '/concessions', '/user-management'],
  },
  {
    prefix: '/api/transactions',
    permissions: ['/fee-collection', '/bulk-fee-upload'],
  },
  {
    prefix: '/api/permissions',
    permissions: ['/permissions'],
  },
  {
    prefix: '/api/proceedings',
    permissions: ['/proceedings', 'proceedings_view', 'proceedings_edit', 'proceedings_verify', 'proceedings_approve', '/fee-collection'],
  },
  {
    prefix: '/api/concessions',
    permissions: ['/concessions', '/fee-collection'],
  },
  {
    prefix: '/api/overall-concessions',
    permissions: [
      '/overall-concessions',
      'overall_concession_add',
      'overall_concession_view',
      'overall_concession_bulk',
      'overall_concession_requests_read',
      'overall_concession_requests_write',
      'overall_concession_requests',
    ],
  },
  {
    prefix: '/api/reminders',
    permissions: ['/reminders'],
  },
  {
    prefix: '/api/students',
    permissions: [
      '/students',
      '/fee-collection',
      '/fee-config',
      '/hostel-config',
      '/bulk-fee-upload',
      '/permissions',
      '/due-reports',
      '/concessions',
      '/overall-concessions',
      '/proceedings',
      'proceedings_view',
      'proceedings_edit',
      'proceedings_verify',
      'proceedings_approve',
      '/reminders',
      '/transport-config',
    ],
  },
  {
    prefix: '/api/settings',
    permissions: ['/settings', '/fee-collection'],
  },
  {
    prefix: '/api/hostels',
    permissions: ['/hostel-config', '/fee-config'],
  },
  {
    prefix: '/api/transport',
    permissions: ['/transport-config', '/fee-collection'],
  },
].sort((a, b) => b.prefix.length - a.prefix.length);

const findRule = (path) => API_ACCESS_RULES.find((rule) => path.startsWith(rule.prefix));

const hasPermission = (user, permissionList = []) => {
  const userPerms = user?.permissions || [];
  return permissionList.some((p) => userPerms.includes(p));
};

const checkTransactionAccess = (req, user) => {
  if (req.method === 'PUT') {
    return hasPermission(user, ['fee_collection_edit', 'fee_collection_delete']);
  }

  if (req.method === 'DELETE') {
    return hasPermission(user, ['fee_collection_delete']);
  }

  if (req.method === 'GET') {
    return hasPermission(user, ['/fee-collection', '/bulk-fee-upload', 'fee_collection_edit', 'fee_collection_delete']);
  }


  const body = req.body || {};
  const firstTx = Array.isArray(body.transactions) ? body.transactions[0] : body;
  const txType = firstTx?.transactionType || 'DEBIT';

  if (txType === 'CREDIT') {
    return (
      hasPermission(user, ['fee_collection_concession']) ||
      hasPermission(user, ['/fee-collection', '/bulk-fee-upload'])
    );
  }

  return (
    hasPermission(user, ['fee_collection_pay']) ||
    hasPermission(user, ['/fee-collection', '/bulk-fee-upload'])
  );
};

const authorize = (req, res, next) => {
  const user = req.user;
  if (!user) {
    return res.status(401).json({ message: 'Not authorized' });
  }

  const path = req.originalUrl.split('?')[0];

  // Restrict User/Role Management changes to authorized users
  if (path.startsWith('/api/users') || path.startsWith('/api/roles')) {
    // Allow any authenticated user to retrieve their own profile details
    if (path === '/api/users/me' && req.method === 'GET') {
      return next();
    }

    if (user.role === 'superadmin' || user.role === 'admin' || hasPermission(user, ['/user-management'])) {
      return next();
    }
    return res.status(403).json({ message: 'Forbidden: User/Role Management changes require appropriate privileges' });
  }


  if (user.role === 'superadmin' || user.role === 'admin') {
    return next();
  }

  // Restrict proceeding approve to proceedings_approve (controller also enforces)
  if (path.match(/^\/api\/proceedings\/[^/]+\/approve$/) && req.method === 'PUT') {
    if (hasPermission(user, ['proceedings_approve'])) {
      return next();
    }
    return res.status(403).json({ message: 'Forbidden: proceedings approve permission required' });
  }

  // Restrict proceeding verify to proceedings_verify
  if (path.match(/^\/api\/proceedings\/[^/]+\/verify$/) && req.method === 'PUT') {
    if (hasPermission(user, ['proceedings_verify'])) {
      return next();
    }
    return res.status(403).json({ message: 'Forbidden: proceedings verify permission required' });
  }

  // Restrict proceeding creation & student loading (POST) to proceedings_view, proceedings_edit, or /proceedings
  if (path.startsWith('/api/proceedings') && req.method === 'POST') {
    if (hasPermission(user, ['proceedings_view', 'proceedings_edit', '/proceedings'])) {
      return next();
    }
    return res.status(403).json({ message: 'Forbidden: proceedings create/view permission required' });
  }

  // Restrict proceeding modifications and deletion (PUT/DELETE) to proceedings_edit
  if (path.startsWith('/api/proceedings') && (req.method === 'PUT' || req.method === 'DELETE')) {
    if (hasPermission(user, ['proceedings_edit'])) {
      return next();
    }
    return res.status(403).json({ message: 'Forbidden: proceedings edit permission required' });
  }

  // Overall concession tab/action permissions (Declaration module)
  // `/overall-concessions` alone is page access only. Full legacy unlock applies
  // only when that page path exists and no tab-level sub-permissions are set.
  const OVERALL_CONC_SUBS = [
    'overall_concession_add',
    'overall_concession_view',
    'overall_concession_bulk',
    'overall_concession_requests_read',
    'overall_concession_requests_write',
    'overall_concession_requests', // legacy write
  ];
  const hasOverallPagePath = () => hasPermission(user, ['/overall-concessions']);
  const hasOverallAnySub = () => hasPermission(user, OVERALL_CONC_SUBS);
  const hasOverallLegacyFull = () => hasOverallPagePath() && !hasOverallAnySub();
  const hasOverallConcessionPerm = (...keys) => (
    hasOverallLegacyFull() || hasPermission(user, keys)
  );
  const hasOverallRequestsRead = () => hasOverallConcessionPerm(
    'overall_concession_requests_read',
    'overall_concession_requests_write',
    'overall_concession_requests'
  );
  const hasOverallRequestsWrite = () => hasOverallConcessionPerm(
    'overall_concession_requests_write',
    'overall_concession_requests'
  );

  if (path.startsWith('/api/overall-concessions')) {
    if (path === '/api/overall-concessions' && req.method === 'GET') {
      if (
        hasOverallLegacyFull()
        || hasOverallPagePath()
        || hasPermission(user, [
          'overall_concession_add',
          'overall_concession_view',
          'overall_concession_bulk',
          'overall_concession_requests_read',
          'overall_concession_requests_write',
          'overall_concession_requests',
        ])
      ) {
        return next();
      }
      return res.status(403).json({ message: 'Forbidden: overall concession view/add/bulk permission required' });
    }

    if (path === '/api/overall-concessions' && req.method === 'POST') {
      if (hasOverallConcessionPerm('overall_concession_add')) {
        return next();
      }
      return res.status(403).json({ message: 'Forbidden: overall concession add/manage permission required' });
    }

    if (path.match(/^\/api\/overall-concessions\/[^/]+$/) && req.method === 'DELETE') {
      if (hasOverallConcessionPerm('overall_concession_add')) {
        return next();
      }
      return res.status(403).json({ message: 'Forbidden: overall concession add/manage permission required' });
    }

    if ((path === '/api/overall-concessions/bulk' || path === '/api/overall-concessions/bulk-multi') && req.method === 'POST') {
      if (hasOverallConcessionPerm('overall_concession_bulk')) {
        return next();
      }
      return res.status(403).json({ message: 'Forbidden: overall concession bulk permission required' });
    }

    if (path === '/api/overall-concessions/request' && req.method === 'POST') {
      if (hasOverallConcessionPerm('overall_concession_add')) {
        return next();
      }
      return res.status(403).json({ message: 'Forbidden: overall concession add/manage permission required' });
    }

    if (path === '/api/overall-concessions/requests' && req.method === 'GET') {
      if (hasOverallRequestsRead()) {
        return next();
      }
      return res.status(403).json({ message: 'Forbidden: overall concession requests read permission required' });
    }

    if (path.match(/^\/api\/overall-concessions\/requests\/[^/]+/) && req.method === 'PUT') {
      if (hasOverallRequestsWrite()) {
        return next();
      }
      return res.status(403).json({ message: 'Forbidden: overall concession requests write permission required' });
    }
  }

  // Restrict Concession process/bulk-process/modify-approved (PUT requests) strictly to /concessions permission
  if (path.startsWith('/api/concessions') && req.method === 'PUT') {
    if (hasPermission(user, ['/concessions'])) {
      return next();
    }
    return res.status(403).json({ message: 'Forbidden: concession approvals require concessions permission' });
  }

  // Restrict Concession Approver modifications/management strictly to /concessions or /user-management
  if (path.startsWith('/api/concession-approvers')) {
    const isBasicGet = req.method === 'GET' && path === '/api/concession-approvers';
    if (!isBasicGet) {
      if (hasPermission(user, ['/concessions', '/user-management'])) {
        return next();
      }
      return res.status(403).json({ message: 'Forbidden: concession approver management requires concessions or user management permissions' });
    }
  }

  // Dashboard overview is the default landing page for all authenticated staff
  if (path.startsWith('/api/reports/dashboard-stats')) {
    return next();
  }

  if (path.startsWith('/api/campuses')) {
    return next();
  }

  if (path.startsWith('/api/transactions')) {
    if (checkTransactionAccess(req, user)) {
      return next();
    }
    return res.status(403).json({ message: 'Forbidden: insufficient permissions for this transaction' });
  }

  const rule = findRule(path);
  if (!rule) {
    return res.status(403).json({ message: 'Forbidden: endpoint not configured for access control' });
  }

  if (rule.superadminOnly) {
    return res.status(403).json({ message: 'Forbidden: superadmin access required' });
  }

  if (hasPermission(user, rule.permissions)) {
    return next();
  }

  return res.status(403).json({ message: 'Forbidden: insufficient permissions' });
};

module.exports = { authorize, API_ACCESS_RULES };
