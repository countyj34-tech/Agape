import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import {
  Home,
  Package,
  BarChart3,
  Settings,
  FolderOpen,
  FileText,
  ShoppingBag,
  Users,
  Wallet,
  LogOut,
  Building2,
  HelpCircle,
  BrainCircuit,
  Monitor,
  X,
} from 'lucide-react';
import { useSupabaseAuth } from '@/contexts/SupabaseAuthContext';
import { cn } from '@/lib/utils';
import { StoreSwitcher } from '@/components/layout/StoreSwitcher';
import { isAdminRole, isSuperAdminRole } from '@/lib/permissions';
import { unlockPageInteraction } from '@/lib/unlockPageInteraction';
import { posNavigate } from '@/lib/posNavigate';

type SideMenuContextValue = {
  openMenu: () => void;
  closeMenu: () => void;
};

const SideMenuContext = createContext<SideMenuContextValue | null>(null);

export function useSideMenu() {
  const ctx = useContext(SideMenuContext);
  if (!ctx) {
    return {
      openMenu: () => undefined,
      closeMenu: () => undefined,
    };
  }
  return ctx;
}

type MenuItem = {
  to: string;
  icon: typeof Home;
  label: string;
  section: 'main' | 'admin';
  requiresAuth?: boolean;
  hideWhenAuthenticated?: boolean;
  superAdminOnly?: boolean;
};

const MENU_ITEMS: MenuItem[] = [
  { to: '/', icon: Home, label: 'Point of Sale', section: 'main' },
  { to: '/sales', icon: ShoppingBag, label: 'Sales (Today)', section: 'main' },
  { to: '/reports', icon: FileText, label: 'Reports (EOD)', section: 'main' },
  { to: '/inventory-audit', icon: Package, label: 'Daily Audit', section: 'main' },
  { to: '/customers', icon: Users, label: 'Customer Book', section: 'main' },
  { to: '/expenses', icon: Wallet, label: 'Expenses', section: 'main' },
  { to: '/help', icon: HelpCircle, label: 'User Manual', section: 'main' },
  { to: '/setup-store', icon: Building2, label: 'Store Setup', section: 'admin', requiresAuth: true },
  { to: '/login?tab=staff', icon: Users, label: 'Staff Login', section: 'admin', requiresAuth: false, hideWhenAuthenticated: true },
  { to: '/login?tab=admin', icon: BarChart3, label: 'Admin Login', section: 'admin', requiresAuth: false, hideWhenAuthenticated: true },
  { to: '/admin', icon: BarChart3, label: 'Dashboard', section: 'admin', requiresAuth: true },
  { to: '/admin/ai-stock', icon: BrainCircuit, label: 'AI Stock Processing', section: 'admin', requiresAuth: true, superAdminOnly: true },
  { to: '/admin/companies', icon: Users, label: 'Staff & Company', section: 'admin', requiresAuth: true },
  { to: '/admin/inventory', icon: Package, label: 'Inventory', section: 'admin', requiresAuth: true },
  { to: '/admin/stock-master', icon: FileText, label: 'Stock Master', section: 'admin', requiresAuth: true },
  { to: '/admin/categories', icon: FolderOpen, label: 'Categories', section: 'admin', requiresAuth: true },
  { to: '/admin/stores', icon: Building2, label: 'Stores / Branches', section: 'admin', requiresAuth: true },
  { to: '/admin/settings/customer-display', icon: Monitor, label: 'Customer Display', section: 'admin', requiresAuth: true },
  { to: '/admin/settings', icon: Settings, label: 'Settings', section: 'admin', requiresAuth: true },
];

function GlobalSideMenuDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { isAdminAuthenticated, settings, logout, user, profile, membership, company } = useSupabaseAuth();
  const canAccessAdmin = isAdminAuthenticated && isAdminRole(settings?.userRole);
  const isStoreStaff = !canAccessAdmin;
  const isAnyUserLoggedIn = Boolean(user || profile || membership || company || settings?.userRole);
  const isSuperAdmin = isSuperAdminRole(settings?.userRole);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const isActive = (to: string) => {
    const path = to.split('?')[0] || to;
    if (path === '/') return location.pathname === '/';
    return location.pathname === path || location.pathname.startsWith(`${path}/`);
  };

  const mainItems = MENU_ITEMS.filter((item) => {
    if (item.section !== 'main') return false;
    if (!isStoreStaff) return true;
    return (
      item.to === '/' ||
      item.to === '/sales' ||
      item.to === '/reports' ||
      item.to === '/inventory-audit' ||
      item.to === '/customers' ||
      item.to === '/expenses' ||
      item.to === '/help'
    );
  });

  const adminItems = MENU_ITEMS.filter(
    (item) =>
      item.section === 'admin' &&
      (!item.requiresAuth || canAccessAdmin) &&
      (!item.hideWhenAuthenticated || !isAdminAuthenticated) &&
      (!item.superAdminOnly || isSuperAdmin)
  );

  if (!open || typeof document === 'undefined') return null;

  const NavRow = ({ item }: { item: MenuItem }) => (
    <Link
      to={item.to}
      onClick={(e) => {
        e.preventDefault();
        onClose();
        unlockPageInteraction();
        if (location.pathname === (item.to.split('?')[0] || item.to) && !item.to.includes('?')) {
          return;
        }
        posNavigate(navigate, item.to);
      }}
      className={cn(
        'mb-0.5 flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm font-medium transition-colors',
        isActive(item.to)
          ? 'bg-secondary text-secondary-foreground'
          : 'hover:bg-accent hover:text-accent-foreground'
      )}
    >
      <item.icon className="h-5 w-5 shrink-0" />
      {item.label}
    </Link>
  );

  return createPortal(
    <div className="fixed inset-0 z-[500]" role="dialog" aria-modal="true" aria-label="Main menu">
      <button
        type="button"
        className="absolute inset-0 z-0 bg-black/50"
        aria-label="Close menu"
        onClick={onClose}
      />
      <aside className="absolute inset-y-0 left-0 z-10 flex h-full w-72 flex-col border-r bg-background shadow-2xl">
        <div className="flex items-center justify-between border-b p-4">
          <h2 className="text-lg font-bold text-primary">Mthunzi-POS</h2>
          <Button type="button" variant="ghost" size="icon" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </Button>
        </div>

        <nav className="flex flex-1 flex-col overflow-y-auto p-2">
          <div className="mb-2">
            <p className="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Sales
            </p>
            {mainItems.map((item) => (
              <NavRow key={item.to} item={item} />
            ))}
          </div>

          {!isStoreStaff && (
            <>
              <div className="mb-2 border-t pt-2">
                <StoreSwitcher />
              </div>
              <div className="mb-2">
                <p className="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Admin
                </p>
                {adminItems.map((item) => (
                  <NavRow key={item.to} item={item} />
                ))}
              </div>
            </>
          )}

          {isAnyUserLoggedIn && (
            <div className="mt-auto border-t pt-2">
              <button
                type="button"
                className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm font-medium text-destructive hover:bg-destructive/10"
                onClick={() => {
                  onClose();
                  logout();
                  navigate('/login');
                }}
              >
                <LogOut className="h-5 w-5" />
                {isAdminAuthenticated ? 'Lock Admin' : 'Logout'}
              </button>
            </div>
          )}
        </nav>
      </aside>
    </div>,
    document.body
  );
}

export function SideMenuProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const location = useLocation();

  const closeMenu = useCallback(() => {
    setOpen(false);
    unlockPageInteraction();
  }, []);

  const openMenu = useCallback(() => {
    unlockPageInteraction();
    setOpen(true);
  }, []);

  useEffect(() => {
    setOpen(false);
    unlockPageInteraction();
  }, [location.pathname, location.search]);

  const value = useMemo(() => ({ openMenu, closeMenu }), [openMenu, closeMenu]);

  return (
    <SideMenuContext.Provider value={value}>
      {children}
      <GlobalSideMenuDrawer open={open} onClose={closeMenu} />
    </SideMenuContext.Provider>
  );
}
