import { Home, Package, BarChart3, Settings, ShoppingCart, FileText, ShoppingBag, Users } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { useCart } from '@/contexts/CartContext';
import { usePendingOrdersCount } from '@/hooks/usePendingOrdersCount';
import { useSupabaseAuth } from '@/contexts/SupabaseAuthContext';
import { unlockPageInteraction } from '@/lib/unlockPageInteraction';
import { posNavigate } from '@/lib/posNavigate';

interface NavItem {
  to: string;
  icon: typeof Home;
  label: string;
  badge?: number;
  badgeColor?: string;
}

export function MobileNav() {
  const { itemCount } = useCart();
  const location = useLocation();
  const navigate = useNavigate();
  const { count: pendingOrdersCount } = usePendingOrdersCount(
    location.pathname === '/' || location.pathname.startsWith('/sales') || location.pathname.startsWith('/admin')
  );
  const { isAdminAuthenticated } = useSupabaseAuth();
  const isAdmin = location.pathname.startsWith('/admin');
  const isStoreStaff = !isAdminAuthenticated;

  const posNavItems: NavItem[] = [
    { to: '/', icon: Home, label: 'POS' },
    { to: '/sales', icon: ShoppingBag, label: 'Sales', badge: pendingOrdersCount, badgeColor: 'bg-red-500' },
    { to: '/reports', icon: FileText, label: 'Reports' },
    { to: '/customers', icon: Users, label: 'Customers' },
    { to: '/cart', icon: ShoppingCart, label: 'Cart', badge: itemCount },
  ];

  const adminNavItems: NavItem[] = [
    { to: '/admin', icon: BarChart3, label: 'Dashboard' },
    { to: '/sales', icon: ShoppingBag, label: 'Sales' },
    { to: '/reports', icon: FileText, label: 'Reports' },
    { to: '/admin/inventory', icon: Package, label: 'Inventory' },
    { to: '/admin/settings', icon: Settings, label: 'Settings' },
  ];

  const navItems = isAdmin
    ? adminNavItems
    : isStoreStaff
    ? posNavItems.filter((item) => item.to === '/' || item.to === '/sales')
    : posNavItems;

  const go = (to: string) => {
    const path = to.split('?')[0] || to;
    if (location.pathname === path) return;
    posNavigate(navigate, to);
  };

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 safe-bottom md:hidden">
      <div className="flex h-16 items-center justify-around px-2">
        {navItems.map((item) => {
          const active =
            item.to === '/' || item.to === '/admin'
              ? location.pathname === item.to
              : location.pathname === item.to || location.pathname.startsWith(`${item.to}/`);

          return (
            <button
              key={item.to}
              type="button"
              onClick={() => go(item.to)}
              className={cn(
                'flex flex-1 flex-col items-center justify-center gap-1 py-2 text-xs font-medium transition-colors',
                active ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <div className="relative">
                <item.icon className="h-5 w-5" />
                {item.badge !== undefined && item.badge > 0 && (
                  <span
                    className={cn(
                      'absolute -right-2 -top-1 flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold text-white',
                      item.badgeColor || 'bg-primary'
                    )}
                  >
                    {item.badge > 9 ? '9+' : item.badge}
                  </span>
                )}
              </div>
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
