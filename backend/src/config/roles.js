// Roles and permissions. Pure module (no dependencies) so it can be unit tested.

const ROLES = [
  'super_admin',
  'central_admin',
  'store_manager',
  'pharmacist',
  'inventory_manager',
  'purchase_manager',
  'pos_operator',
  'accountant',
  'support_agent',
  'delivery_manager',
  'delivery_partner',
  'advertiser',
  'wholesale_buyer',
  'customer',
];

const ROLE_LABELS = {
  super_admin: 'Super Admin / Platform Owner',
  central_admin: 'Central Admin',
  store_manager: 'Store Manager',
  pharmacist: 'Pharmacist',
  inventory_manager: 'Inventory Manager',
  purchase_manager: 'Purchase Manager',
  pos_operator: 'POS Operator',
  accountant: 'Accountant',
  support_agent: 'Support Agent',
  delivery_manager: 'Delivery Manager',
  delivery_partner: 'Delivery Partner',
  advertiser: 'Advertiser',
  wholesale_buyer: 'Wholesale Buyer',
  customer: 'Customer',
};

// Staff roles work inside the admin panel and are limited to assigned stores.
const STAFF_ROLES = [
  'super_admin',
  'central_admin',
  'store_manager',
  'pharmacist',
  'inventory_manager',
  'purchase_manager',
  'pos_operator',
  'accountant',
  'support_agent',
  'delivery_manager',
];

const ADMIN_ROLES = ['super_admin', 'central_admin'];

const PERMISSIONS = [
  'stores.view', 'stores.manage',
  'admins.manage', 'users.manage', 'customers.manage',
  'employees.view', 'employees.manage', 'salary.view',
  'products.view', 'products.manage', 'categories.manage', 'barcodes.register',
  'inventory.view', 'inventory.manage', 'transfers.manage',
  'suppliers.view', 'suppliers.manage', 'purchases.view', 'purchases.manage',
  'pos.use', 'pos.price_override',
  'orders.view', 'orders.manage',
  'prescriptions.review', 'requests.manage',
  'payments.view', 'payments.manage', 'payments.config',
  'refunds.request', 'refunds.approve',
  'delivery.manage', 'delivery.self',
  'coupons.manage',
  'expenses.manage', 'expenses.approve',
  'reports.view',
  'ads.manage', 'ads.self',
  'wholesale.manage', 'wholesale.self',
  'support.manage',
  'import.manage', 'export.data',
  'settings.manage',
  'audit.view',
  'whatsapp.manage',
];

const ROLE_PERMISSIONS = {
  super_admin: ['*'],
  central_admin: PERMISSIONS.filter((p) => !['admins.manage', 'settings.manage', 'payments.config'].includes(p)),
  store_manager: [
    'stores.view', 'employees.view', 'employees.manage', 'customers.manage',
    'products.view', 'barcodes.register',
    'inventory.view', 'inventory.manage', 'transfers.manage',
    'suppliers.view', 'suppliers.manage', 'purchases.view', 'purchases.manage',
    'pos.use', 'pos.price_override',
    'orders.view', 'orders.manage', 'requests.manage',
    'payments.view', 'refunds.request', 'refunds.approve',
    'delivery.manage', 'expenses.manage', 'reports.view',
    'support.manage', 'import.manage', 'export.data', 'whatsapp.manage',
  ],
  pharmacist: [
    'stores.view', 'products.view', 'inventory.view', 'prescriptions.review', 'requests.manage',
    'orders.view', 'orders.manage', 'pos.use', 'barcodes.register', 'whatsapp.manage',
  ],
  inventory_manager: [
    'stores.view', 'products.view', 'products.manage', 'categories.manage', 'barcodes.register',
    'inventory.view', 'inventory.manage', 'transfers.manage', 'suppliers.view', 'purchases.view',
    'import.manage', 'export.data',
  ],
  purchase_manager: [
    'stores.view', 'products.view', 'inventory.view', 'suppliers.view', 'suppliers.manage',
    'purchases.view', 'purchases.manage', 'import.manage', 'export.data',
  ],
  pos_operator: ['stores.view', 'products.view', 'inventory.view', 'pos.use', 'orders.view', 'refunds.request'],
  accountant: [
    'stores.view', 'reports.view', 'expenses.manage', 'expenses.approve', 'payments.view', 'payments.manage',
    'refunds.approve', 'orders.view', 'purchases.view', 'suppliers.view', 'export.data', 'salary.view',
  ],
  support_agent: [
    'stores.view', 'support.manage', 'orders.view', 'refunds.request', 'requests.manage', 'whatsapp.manage',
    'products.view',
  ],
  delivery_manager: ['stores.view', 'delivery.manage', 'orders.view'],
  delivery_partner: ['delivery.self'],
  advertiser: ['ads.self'],
  wholesale_buyer: ['wholesale.self'],
  customer: [],
};

function rolePermissions(role) {
  return ROLE_PERMISSIONS[role] || [];
}

/**
 * user: { role, permissions?: string[] (extra grants), deniedPermissions?: string[] }
 */
function hasPermission(user, permission) {
  if (!user || !user.role) return false;
  const denied = user.deniedPermissions || [];
  if (user.role !== 'super_admin' && denied.includes(permission)) return false;
  const base = rolePermissions(user.role);
  if (base.includes('*')) return true;
  if (base.includes(permission)) return true;
  return (user.permissions || []).includes(permission);
}

function effectivePermissions(user) {
  if (!user) return [];
  const base = rolePermissions(user.role);
  if (base.includes('*')) return [...PERMISSIONS];
  const set = new Set([...base, ...(user.permissions || [])]);
  for (const d of user.deniedPermissions || []) set.delete(d);
  return [...set];
}

function isStaff(role) {
  return STAFF_ROLES.includes(role);
}

/** Who may create a user with a given role. */
function canAssignRole(actor, targetRole) {
  if (!actor) return false;
  if (actor.role === 'super_admin') return ROLES.includes(targetRole);
  if (targetRole === 'super_admin' || targetRole === 'central_admin') return false;
  if (actor.role === 'central_admin') return true;
  if (actor.role === 'store_manager') {
    return ['pharmacist', 'inventory_manager', 'purchase_manager', 'pos_operator', 'support_agent', 'delivery_partner'].includes(targetRole);
  }
  if (actor.role === 'delivery_manager') return targetRole === 'delivery_partner';
  return false;
}

module.exports = {
  ROLES,
  ROLE_LABELS,
  STAFF_ROLES,
  ADMIN_ROLES,
  PERMISSIONS,
  ROLE_PERMISSIONS,
  hasPermission,
  effectivePermissions,
  isStaff,
  canAssignRole,
};
