import type { Settings } from '@/types/pos';

export function isAdminRole(userRole?: Settings['userRole']) {
  return userRole === 'owner' || userRole === 'manager' || userRole === 'super_admin';
}

export function isSuperAdminRole(userRole?: Settings['userRole']) {
  return userRole === 'super_admin';
}

export function isStaffRole(userRole?: Settings['userRole']) {
  return !isAdminRole(userRole) && userRole !== undefined;
}

export function isStoreStaffRole(userRole?: Settings['userRole']) {
  return userRole === 'salesperson' || userRole === 'cashier' || userRole === 'delivery' || userRole === 'other' || userRole === 'staff';
}

export function canViewSensitiveData(userRole?: Settings['userRole'], isAdminAuthenticated?: boolean) {
  return isAdminAuthenticated || isAdminRole(userRole);
}

export function canAccessStoreLimitedView(userRole?: Settings['userRole']) {
  return userRole === 'salesperson' || userRole === 'cashier' || userRole === 'delivery' || userRole === 'other' || userRole === 'staff';
}
