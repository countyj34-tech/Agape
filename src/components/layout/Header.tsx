import { Search, Camera, Menu, ShoppingCart, Settings, Sun, Moon, Eclipse, AlertTriangle, Printer, Bell, LogIn, LogOut } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNotification } from '@/contexts/NotificationContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { OfflineIndicator } from '@/components/pos/OfflineIndicator';
import { ShiftControl } from '@/components/pos/ShiftControl';
import { useCart } from '@/contexts/CartContext';
import { cn } from '@/lib/utils';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTheme } from 'next-themes';
import { useStore } from '@/contexts/StoreContext';
import { useLiveQuery } from 'dexie-react-hooks';
import { dexieDb, clearShiftAuditLock } from '@/lib/db';
import { toast } from 'sonner';
import { useBluetoothPrinter } from '@/hooks/useBluetoothPrinter';
import { useSupabaseAuth } from '@/contexts/SupabaseAuthContext';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { usePendingOrdersCount } from '@/hooks/usePendingOrdersCount';
import { posNavigate } from '@/lib/posNavigate';
import { unlockPageInteraction } from '@/lib/unlockPageInteraction';

interface HeaderProps {
  onMenuClick?: () => void;
  onSearchChange?: (query: string) => void;
  onBarcodeClick?: () => void;
  onCartClick?: () => void;
  searchValue?: string;
  showSearch?: boolean;
  title?: string;
}

function HeaderClock() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const time = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const date = now.toLocaleDateString([], { weekday: 'short', day: '2-digit', month: 'short' });

  return (
    <div className="hidden flex-col items-end leading-tight sm:flex">
      <span className="font-mono text-sm font-semibold tracking-tight tabular-nums">{time}</span>
      <span className="text-[10px] text-muted-foreground">{date}</span>
    </div>
  );
}

export function Header({
  onMenuClick,
  onSearchChange,
  onBarcodeClick,
  onCartClick,
  searchValue = '',
  showSearch = true,
  title,
}: HeaderProps) {
  const { itemCount } = useCart();
  const location = useLocation();
  const isAdmin = location.pathname.startsWith('/admin');
  const { theme, setTheme } = useTheme();
  const { stores, currentStoreId, setCurrentStoreId, isGlobalView } = useStore();

  const activeShift = useLiveQuery(() => dexieDb.shifts.where('status').equals('open').first(), []);
  const [unlockOpen, setUnlockOpen] = useState(false);
  const [adminPin, setAdminPin] = useState('');
  const { state: printerState, discoverAndConnect, openDrawer } = useBluetoothPrinter();
  const { settings, logout, user, profile, membership, company, isAdminAuthenticated } = useSupabaseAuth();
  const navigate = useNavigate();
  const canManageAdmin = isAdminAuthenticated && (settings?.userRole === 'owner' || settings?.userRole === 'manager');
  const isStoreStaff = !canManageAdmin;
  const isLoggedIn = Boolean(user || profile || membership || company || settings?.userRole);

  const trackPendingOrders =
    location.pathname === '/' ||
    location.pathname.startsWith('/sales') ||
    location.pathname.startsWith('/admin');
  const { count: pendingOrdersCount } = usePendingOrdersCount(trackPendingOrders);

  // Notification panel state
  const [showNotifications, setShowNotifications] = useState(false);
  const { notifications, markAsRead, markAllAsRead, removeNotification } = useNotification();
  // Only show unread notifications
  const unreadNotifications = notifications.filter(n => !n.read);
  const unreadCount = unreadNotifications.length;
  const navBadgeCount = pendingOrdersCount + unreadCount;
  // Play notification sound
  const playNotificationSound = () => {
    const audio = new Audio('/sounds/notification.mp3');
    const playPromise = audio.play();
    if (playPromise && typeof playPromise.catch === 'function') {
      playPromise.catch((error: any) => {
        if (error?.name !== 'AbortError') {
          console.warn('Notification sound failed:', error);
        }
      });
    }
  };
  // Always show bell, only open panel when bell is clicked
  const isMarketplace = location.pathname.startsWith('/shop');

  const cycleTheme = () => {
    const t = (theme ?? 'light') as string;
    const next = t === 'light' ? 'dark' : t === 'dark' ? 'night' : 'light';
    setTheme(next);
  };

  const printerIconClass = useMemo(() => {
    switch (printerState.kind) {
      case 'connected':
        return 'text-green-500';
      case 'connecting':
        return 'text-amber-500 animate-pulse';
      case 'disconnected':
        return 'text-red-500';
      case 'unsupported':
        return 'text-gray-400';
      case 'error':
        return 'text-red-600';
      default:
        return 'text-muted-foreground';
    }
  }, [printerState.kind]);

  return (
    <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 safe-top">
      <div className="flex h-16 items-center gap-3 px-4">
        {/* Menu Button */}
        <Button
          variant="ghost"
          size="icon"
          onClick={onMenuClick}
          className="shrink-0"
        >
          <Menu className="h-5 w-5" />
          <span className="sr-only">Menu</span>
        </Button>

        {/* Title or Search */}
        {showSearch ? (
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search products..."
              value={searchValue}
              onChange={(e) => onSearchChange?.(e.target.value)}
              className="h-10 pl-9 pr-10"
            />
            {onBarcodeClick && (
              <Button
                variant="ghost"
                size="icon"
                onClick={onBarcodeClick}
                className="absolute right-1 top-1/2 h-8 w-8 -translate-y-1/2"
              >
                <Camera className="h-4 w-4" />
                <span className="sr-only">Scan barcode</span>
              </Button>
            )}
          </div>
        ) : (
          <div className="flex flex-1 items-center gap-3 leading-tight">
            <div className="flex flex-col">
              <h1 className="text-lg font-semibold">{title}</h1>
              <span className="text-[10px] font-semibold tracking-widest text-muted-foreground">
                MTHUNZI-TECH-LABS
              </span>
            </div>
            {isAdmin && stores.length > 0 && (
              <div className="hidden min-w-[180px] items-center gap-1 rounded-md border bg-muted/40 px-2 py-1 text-[11px] sm:flex">
                <span className="text-muted-foreground">Store:</span>
                <Select
                  value={currentStoreId}
                  onValueChange={setCurrentStoreId}
                >
                  <SelectTrigger className="h-7 border-none bg-transparent px-1 text-[11px] shadow-none focus:ring-0">
                    <SelectValue
                      placeholder={isGlobalView ? 'All Stores' : 'Select store'}
                    />
                  </SelectTrigger>
                  <SelectContent className="text-[11px]">
                    <SelectItem value="__all__" className="text-[11px]">
                      All Stores (Global View)
                    </SelectItem>
                    {stores.map((s) => (
                      <SelectItem key={s.id} value={s.id} className="text-[11px]">
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        )}

        {/* Status & Actions */}
        <div className="flex items-center gap-2">
          <OfflineIndicator />

          {/* Printer status & admin open-drawer */}
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={async () => {
                if (printerState.kind === 'disconnected' || printerState.kind === 'error') {
                  try {
                    const ok = await discoverAndConnect();
                    if (ok) toast.success('Printer connected');
                  } catch (e: any) {
                    toast.error(String(e?.message ?? 'Failed to connect'));
                  }
                }
              }}
              title={
                printerState.kind === 'connected'
                  ? `Printer: ${printerState.deviceName}${
                      printerState.transport === 'serial'
                        ? ' (Serial)'
                        : printerState.transport === 'usb'
                          ? ' (USB)'
                          : printerState.transport === 'ble'
                            ? ' (BLE)'
                            : printerState.transport === 'network'
                              ? ' (Wi‑Fi/LAN)'
                              : ''
                    }`
                  : printerState.kind === 'connecting'
                  ? 'Printer: Connecting'
                  : printerState.kind === 'unsupported'
                  ? 'Printer unsupported'
                  : printerState.kind === 'error'
                  ? 'Printer error'
                  : 'Printer: Disconnected — click to connect Serial/COM'
              }
            >
              <Printer className={cn('h-4 w-4', printerIconClass)} />
              <span className="sr-only">
                {printerState.kind === 'connected' && `Printer connected ${printerState.deviceName}`}
                {printerState.kind === 'connecting' && 'Printer connecting'}
                {printerState.kind === 'disconnected' && 'Printer disconnected'}
                {printerState.kind === 'unsupported' && 'Bluetooth unsupported'}
                {printerState.kind === 'error' && 'Printer error'}
              </span>
            </Button>

            {canManageAdmin && (
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  try {
                    if (printerState.kind !== 'connected') {
                      await discoverAndConnect();
                    }
                    if (!settings) {
                      toast.error('Printer settings not loaded');
                      return;
                    }
                    await openDrawer(settings);
                    toast.success('Drawer pulse sent');
                  } catch (e: any) {
                    toast.error(String(e?.message ?? 'Failed to open drawer'));
                  }
                }}
              >
                Open Drawer
              </Button>
            )}
          </div>

          {!isAdmin && <ShiftControl />}

          {/* Audit Alert Indicator */}
          {activeShift && (activeShift.auditLocked || activeShift.alertStatus === 'theft') && (
            <div className="flex items-center gap-2">
              <Button variant="destructive" size="sm" onClick={() => setUnlockOpen(true)}>
                <AlertTriangle className="h-4 w-4" />
                Alert
              </Button>
            </div>
          )}

          <HeaderClock />

          <Button variant="ghost" size="icon" onClick={cycleTheme} title="Theme">
            {theme === 'dark' ? (
              <Moon className="h-5 w-5" />
            ) : theme === 'night' ? (
              <Eclipse className="h-5 w-5" />
            ) : (
              <Sun className="h-5 w-5" />
            )}
            <span className="sr-only">Toggle theme</span>
          </Button>

          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              if (isLoggedIn) {
                logout();
                navigate('/login');
              } else {
                navigate('/login');
              }
            }}
            title={isLoggedIn ? 'Logout' : 'Login'}
          >
            {isLoggedIn ? (
              <LogOut className="h-5 w-5" />
            ) : (
              <LogIn className="h-5 w-5" />
            )}
            <span className="sr-only">{isLoggedIn ? 'Logout' : 'Login'}</span>
          </Button>

          {!isAdmin && (
            <Button
              variant="ghost"
              size="icon"
              onClick={onCartClick}
              className="relative"
            >
              <ShoppingCart className="h-5 w-5" />
              {itemCount > 0 && (
                <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                  {itemCount > 99 ? '99+' : itemCount}
                </span>
              )}
              <span className="sr-only">Cart</span>
            </Button>
          )}

          {!isAdmin && (
            <Button
              variant="ghost"
              size="icon"
              className="relative"
              onClick={() => setShowNotifications((v) => !v)}
              title={
                pendingOrdersCount > 0
                  ? `${pendingOrdersCount} pending online order${pendingOrdersCount === 1 ? '' : 's'}`
                  : 'Notifications'
              }
            >
              <Bell className="h-5 w-5" />
              {navBadgeCount > 0 && (
                <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
                  {navBadgeCount > 99 ? '99+' : navBadgeCount}
                </span>
              )}
              <span className="sr-only">Notifications</span>
            </Button>
          )}

          {!isStoreStaff && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                unlockPageInteraction();
                posNavigate(navigate, isAdmin ? '/' : '/admin');
              }}
            >
              <Settings className="h-5 w-5" />
              <span className="sr-only">{isAdmin ? 'POS' : 'Admin'}</span>
            </Button>
          )}
        </div>
      </div>
      {unlockOpen && activeShift && (
        <div className="fixed left-1/2 top-1/3 z-50 w-[420px] -translate-x-1/2 rounded-md border bg-card p-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">Audit Unlock (Manager only)</h3>
            <Button variant="ghost" size="icon" onClick={() => setUnlockOpen(false)}>✕</Button>
          </div>
          <p className="text-sm text-muted-foreground mt-2">Shift <span className="font-semibold">{activeShift.cashierName}</span> is locked for audit. Enter manager PIN to clear.</p>
          <div className="mt-4 grid gap-2">
            <Input type="password" placeholder="Manager PIN" value={adminPin} onChange={(e) => setAdminPin(e.target.value)} />
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={async () => {
                try {
                  await clearShiftAuditLock(activeShift.id, adminPin);
                  toast.success('Audit lock cleared');
                  setUnlockOpen(false);
                  setAdminPin('');
                } catch (e: any) {
                  toast.error(String(e?.message ?? 'Failed to unlock'));
                }
              }}>Unlock</Button>
            </div>
          </div>
        </div>
      )}
    {/* Notification Panel — online orders + unread alerts */}
    {showNotifications && (
      <div className="fixed right-2 left-2 top-20 z-50 max-h-[min(70vh,560px)] overflow-hidden rounded-md border bg-white shadow-lg sm:left-auto sm:right-4 sm:w-[26rem]">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div>
            <p className="font-semibold">Notifications</p>
            <p className="text-xs text-muted-foreground">
              {pendingOrdersCount > 0
                ? `${pendingOrdersCount} pending online order${pendingOrdersCount === 1 ? '' : 's'}`
                : 'Online orders appear here'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowNotifications(false)}
            className="text-gray-500 hover:text-black"
          >
            ✕
          </button>
        </div>

        <div className="max-h-[min(60vh,480px)] space-y-3 overflow-y-auto p-3">
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
            <p className="font-medium">
              {pendingOrdersCount > 0
                ? `${pendingOrdersCount} pending online order${pendingOrdersCount === 1 ? '' : 's'}`
                : 'No pending online orders'}
            </p>
            <p className="mt-1 text-xs text-amber-900/80">
              Online orders are managed on the Sales screen so POS checkout stays fast.
            </p>
            <Button
              className="mt-3 w-full"
              size="sm"
              onClick={() => {
                setShowNotifications(false);
                navigate('/sales');
              }}
            >
              Open Sales
            </Button>
          </div>

          {unreadNotifications.length > 0 && (
            <div>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Alerts
                </p>
                <button type="button" onClick={markAllAsRead} className="text-xs text-blue-600">
                  Mark all as read
                </button>
              </div>
              <ul className="space-y-2">
                {unreadNotifications.map((n) => (
                  <li
                    key={n.id}
                    className="flex cursor-pointer items-center gap-2 border-b pb-2 last:border-b-0"
                    onClick={() => {
                      playNotificationSound();
                      removeNotification(n.id);
                      markAsRead(n.id);
                      setShowNotifications(false);
                      navigate('/sales');
                    }}
                  >
                    <span>
                      {n.type === 'order' && <span title="Order">📦</span>}
                      {n.type === 'promotion' && <span title="Promotion">🎉</span>}
                      {n.type === 'item' && <span title="New Item">🛒</span>}
                      {n.type === 'system' && <span title="System">⚙️</span>}
                    </span>
                    <div className="flex-1">
                      <div className="text-sm font-medium">{n.message}</div>
                      <div className="text-xs text-gray-400">{n.time}</div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    )}
  </header>
  );
}
