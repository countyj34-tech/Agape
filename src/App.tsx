import { useEffect, useContext, type ReactNode } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useSupabaseAuth } from '@/contexts/SupabaseAuthContext';
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Outlet, useLocation } from "react-router-dom";
import { CartProvider } from "@/contexts/CartContext";
import { StoreProvider, StoreContext } from "@/contexts/StoreContext";
import { NotificationProvider } from "@/contexts/NotificationContext";
import { useNotification } from "@/contexts/NotificationContext";
import { NotificationCenter } from "@/components/NotificationCenter";
import { subscribeToPendingOrders } from "@/lib/onlineOrders";
import { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import POSPage from "./pages/POSPage";
import CheckoutPage from "./pages/CheckoutPage";
import ReceiptPage from "./pages/ReceiptPage";
import AdminDashboard from "./pages/AdminDashboard";
import InventoryPage from "./pages/InventoryPage";
import ShelfLabelsPage from "./pages/ShelfLabelsPage";
import StockMasterPage from "./pages/StockMasterPage";
import StockHistoryPage from "./pages/StockHistoryPage";
import CategoriesPage from "./pages/CategoriesPage";
import ReportsPage from "./pages/ReportsPage";
import SalesHistoryPage from "./pages/SalesHistoryPage";
import ShiftReportPage from "./pages/ShiftReportPage";
import CustomersPage from "./pages/CustomersPage";
import CustomerDetailPage from "./pages/CustomerDetailPage";
import ExpensesPage from "./pages/ExpensesPage";
import DailyInventoryAuditPage from "./pages/DailyInventoryAuditPage";
import NotFound from "./pages/NotFound";
import { Navigate } from "react-router-dom";
import StoreManagerPage from "./pages/StoreManagerPage";
import UserManualPage from "./pages/UserManualPage";
import FinancialHubPage from "./pages/FinancialHubPage";
import TaxSettingsPage from "./pages/TaxSettingsPage";
import ZRASettingsPage from "./pages/ZRASettingsPage";
import { runDatabaseHealthCheck } from "@/lib/db";
import { requestPersistentStorage } from "@/lib/storageGuard";
import { toast } from "sonner";
import { startBackgroundSync, runBackgroundSync } from "@/lib/sync";
import { AdminGate } from "@/components/admin/AdminGate";
import { HardwareScannerListener } from "@/components/pos/HardwareScannerListener";
import { CustomerDisplayBridge } from "@/components/pos/CustomerDisplayBridge";
import { ActivationGate } from "@/components/admin/ActivationGate";
import { useAutoWhatsAppEod } from "@/hooks/useAutoWhatsAppEod";
// Demo store and demo seeding removed: keep product image bootstraps only
import { initializeProductImagesBucket, syncAllProductImages } from '@/lib/productImageStorage';
import { SignupForm } from '@/components/auth/SignupForm';
import { useAutoAuditSync } from '@/hooks/useAutoAuditSync';
import ActivationPage from "./pages/ActivationPage";
import { BootSplash } from '@/components/BootSplash';
import GuestShopPage from "./pages/GuestShopPage";
import CustomerDisplayPage from "./pages/CustomerDisplayPage";
import CustomerDisplayHardwarePage from "./pages/CustomerDisplayHardwarePage";
import CreateAccountPage from "./pages/CreateAccountPage";
import JoinStorePage from "./pages/JoinStorePage";
import StoreSetupPage from "./pages/StoreSetupPage";
import CompanyManagementPage from "./pages/CompanyManagementPage";
import ViewAllStoresPage from "./pages/ViewAllStoresPage";
import WelcomePage from "./pages/WelcomePage";
import LoginPage from "./pages/LoginPage";
import StockReconciliationCompaniesPage from "./pages/StockReconciliationCompaniesPage";
import StockReconciliationWorkspacePage from "./pages/StockReconciliationWorkspacePage";
import { SuperAdminGate } from "@/components/admin/SuperAdminGate";
import { unlockPageInteraction } from "@/lib/unlockPageInteraction";
import { SideMenuProvider } from "@/components/layout/SideMenu";

function NavigationUnlock() {
  const location = useLocation();
  useEffect(() => {
    unlockPageInteraction();
    const t1 = window.setTimeout(unlockPageInteraction, 50);
    const t2 = window.setTimeout(unlockPageInteraction, 400);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [location.pathname, location.search]);
  return null;
}

const queryClient = new QueryClient();

function ProtectedLayout() {
  return (
    <SideMenuProvider>
      <HardwareScannerListener />
      <CustomerDisplayBridge />
      <Outlet />
    </SideMenuProvider>
  );
}

function FirstRunGate({ children }: { children: ReactNode }) {
  const { company, settings, isSettingsReady, isAuthReady } = useSupabaseAuth();

  if (!isSettingsReady || !isAuthReady) {
    return <BootSplash />;
  }

  const hasCompany = Boolean(company?.id || settings?.companyId);
  if (!hasCompany) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

function DatabaseHealthCheck() {
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const result = await runDatabaseHealthCheck();
      if (cancelled) return;
      if (result.ok && result.healed) {
        toast.success(`Self-heal restored ${result.restoredSales ?? 0} sales from snapshots.`, {
          duration: 8000,
        });
        return;
      }
      if (!result.ok) {
        toast.error(
          "Local database error detected. Please export a backup and consider clearing app storage.",
          { duration: 8000 }
        );
      }
    };

    let idleId: number | undefined;
    let timeoutId: number | undefined;
    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
      idleId = window.requestIdleCallback(() => void run(), { timeout: 30000 });
    } else {
      timeoutId = window.setTimeout(() => void run(), 15000);
    }

    return () => {
      cancelled = true;
      if (idleId != null && 'cancelIdleCallback' in window) {
        window.cancelIdleCallback(idleId);
      }
      if (timeoutId != null) window.clearTimeout(timeoutId);
    };
  }, []);
  return null;
}

function BackgroundSchedulers() {
  const location = useLocation();
  const enabled =
    location.pathname.startsWith('/admin') || location.pathname.startsWith('/reports');
  if (!enabled) return null;
  return (
    <>
      <AutoEodScheduler />
      <AutoAuditSyncScheduler />
    </>
  );
}

function AutoEodScheduler() {
  useAutoWhatsAppEod();
  return null;
}

function AutoAuditSyncScheduler() {
  useAutoAuditSync();
  return null;
}

function ProductImagesBootstrap() {
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        if (!cancelled) await initializeProductImagesBucket();
        if (!cancelled) await syncAllProductImages();
      } catch (error) {
        console.warn('Product images bootstrap failed:', error);
      }
    };

    // Never compete with cashier taps on first paint.
    let idleId: number | undefined;
    let timeoutId: number | undefined;
    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
      idleId = window.requestIdleCallback(() => {
        void run();
      }, { timeout: 20000 });
    } else {
      timeoutId = window.setTimeout(() => {
        void run();
      }, 10000);
    }

    return () => {
      cancelled = true;
      if (idleId != null && 'cancelIdleCallback' in window) {
        window.cancelIdleCallback(idleId);
      }
      if (timeoutId != null) window.clearTimeout(timeoutId);
    };
  }, []);
  return null;
}

function BackgroundSyncBootstrap() {
  const storeCtx = useContext(StoreContext);
  const storeId = storeCtx?.currentStoreId;

  useEffect(() => {
    // Deferred so cashier taps are never competing with first paint.
    let idleId: number | undefined;
    let timeoutId: number | undefined;
    const start = () => {
      startBackgroundSync({ storeId: storeId && storeId !== '__all__' ? storeId : undefined });
    };

    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
      idleId = window.requestIdleCallback(start, { timeout: 12000 });
    } else {
      timeoutId = window.setTimeout(start, 5000);
    }

    return () => {
      if (idleId != null && 'cancelIdleCallback' in window) {
        window.cancelIdleCallback(idleId);
      }
      if (timeoutId != null) window.clearTimeout(timeoutId);
    };
  }, [storeId]);

  return null;
}

function PersistentStorageBootstrap() {
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await requestPersistentStorage();
        if (cancelled) return;
        if (result.supported && result.persisted === false) {
          toast.message("Data Guard is off. Enable it in Admin > Settings to keep data safe.");
        }
      } catch (e) {
        console.error("Persistent storage request failed", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return null;
}



// OrderNotificationListener: listens for new/updated orders and triggers notifications
function OrderNotificationListenerWithStore() {
  const storeCtx = useContext(StoreContext);
  if (!storeCtx) return null;
  const { currentStoreId } = storeCtx;
  const { addNotification } = useNotification();
  const subscriptionRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!currentStoreId) return;

    if (subscriptionRef.current) {
      subscriptionRef.current();
      subscriptionRef.current = null;
    }

    subscriptionRef.current = subscribeToPendingOrders(
      currentStoreId,
      (order) => {
        addNotification({
          type: 'order',
          message: `New order #${order.orderNumber} from ${order.customerName || 'customer'}!`,
          data: { orderId: order.id },
        });
        try {
          const audio = new Audio('/sounds/order-alert.mp3');
          audio.play().catch(() => undefined);
        } catch {
          /* ignore */
        }
      },
      (order) => {
        addNotification({
          type: 'order',
          message: `Order updated: ${order.orderNumber || order.id}`,
          data: { orderId: order.id },
        });
      }
    );

    return () => {
      if (subscriptionRef.current) {
        subscriptionRef.current();
        subscriptionRef.current = null;
      }
    };
  }, [currentStoreId, addNotification]);
  return null;
}

function RoutedApp() {
  return (
    <>
      <NavigationUnlock />
      <BackgroundSchedulers />
      <Routes>
        {/* Public Routes */}
        <Route path="/customer-display" element={<CustomerDisplayPage />} />
        <Route path="/shop/:storeID/:slug?" element={<GuestShopPage storeId="" />} />
        <Route path="/activate" element={<ActivationPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/admin/ai-stock"
          element={
            <SuperAdminGate>
              <StockReconciliationCompaniesPage />
            </SuperAdminGate>
          }
        />
        <Route
          path="/admin/ai-stock/:companyId"
          element={
            <SuperAdminGate>
              <StockReconciliationWorkspacePage />
            </SuperAdminGate>
          }
        />
        <Route path="/signup" element={<CreateAccountPage />} />
        <Route path="/boss-login" element={<Navigate to="/login?tab=admin" replace />} />
        <Route path="/staff-login" element={<Navigate to="/login?tab=staff" replace />} />
        <Route path="/create-account" element={<CreateAccountPage />} />
        <Route path="/join-store" element={<JoinStorePage />} />
        <Route path="/setup-store" element={<StoreSetupPage />} />
        <Route path="/admin/companies" element={<AdminGate><CompanyManagementPage /></AdminGate>} />
        <Route path="/admin/view-all-stores" element={<AdminGate><ViewAllStoresPage /></AdminGate>} />
        <Route element={<ActivationGate />}>
          <Route element={<ProtectedLayout />}>
            {/* POS Routes */}
            <Route path="/" element={<FirstRunGate><POSPage /></FirstRunGate>} />
            <Route path="/pos" element={<Navigate to="/" replace />} />
            <Route path="/cart" element={<CheckoutPage />} />
            <Route path="/checkout" element={<CheckoutPage />} />
            <Route path="/receipt/:id" element={<ReceiptPage />} />
            {/* Admin Routes */}
            <Route element={<AdminGate><Outlet /></AdminGate>}>
              <Route path="/admin" element={<AdminDashboard />} />
              <Route path="/admin/financials" element={<FinancialHubPage />} />
              <Route path="/admin/tax" element={<TaxSettingsPage />} />
              <Route path="/admin/settings/zra" element={<ZRASettingsPage />} />
              <Route path="/admin/settings/customer-display" element={<CustomerDisplayHardwarePage />} />
              <Route path="/admin/inventory" element={<InventoryPage />} />
              <Route path="/admin/shelf-labels" element={<ShelfLabelsPage />} />
              <Route path="/admin/stock-master" element={<StockMasterPage />} />
              <Route path="/admin/stock-history" element={<StockHistoryPage />} />
              <Route path="/admin/stores" element={<StoreManagerPage />} />
              <Route path="/admin/categories" element={<CategoriesPage />} />
              <Route path="/admin/reports" element={<Navigate to="/reports" replace />} />
              <Route path="/admin/settings" element={<AdminDashboard />} />
            </Route>
            {/* Salesperson Reports */}
            <Route path="/reports" element={<ReportsPage />} />
            <Route path="/sales" element={<SalesHistoryPage />} />
            <Route path="/help" element={<UserManualPage />} />
            <Route path="/shift/:id" element={<ShiftReportPage />} />
            <Route path="/customers" element={<CustomersPage />} />
            <Route path="/customers/:id" element={<CustomerDetailPage />} />
            <Route path="/expenses" element={<ExpensesPage />} />
            <Route path="/inventory-audit" element={<DailyInventoryAuditPage />} />
            {/* 404 */}
            <Route path="*" element={<NotFound />} />
          </Route>
        </Route>
      </Routes>
    </>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <CartProvider>
        <StoreProvider>
          <NotificationProvider>
            <Toaster />
            <Sonner />
            {/* Online-order cloud listener disabled on POS terminals — keeps sales floor offline-fast. */}
            <DatabaseHealthCheck />
            <PersistentStorageBootstrap />
            <BackgroundSyncBootstrap />
            {/* EOD/audit schedulers mount only on admin/reports routes */}
            {/* POS terminals need sync route commits — deferred transitions leave the old screen painted. */}
            <BrowserRouter unstable_useTransitions={false}>
              <RoutedApp />
            </BrowserRouter>
          </NotificationProvider>
        </StoreProvider>
      </CartProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
