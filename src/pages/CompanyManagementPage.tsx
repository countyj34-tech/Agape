import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { Building2, Plus, Edit, Trash2, Store, Users, Phone, Mail, MapPin, Settings, Eye, EyeOff, Cloud, Home, Loader2 } from 'lucide-react';
import { createCompany, updateCompany, deleteCompany, syncToSupabase, listCompaniesForCurrentUser } from '@/lib/companyManagement';
import { SupabaseFirstService } from '@/lib/supabaseFirst';
import { createCompanyStore, getCompanyStores, deleteCompanyStore, assignStoresToCompany, getUnassignedStores } from '@/lib/storeManagement';
import { getCompanyStaff, addStaff, updateStaff, deleteStaff } from '@/lib/companyManagement';
import { normalizeEmail, normalizePhone } from '@/lib/phoneHelpers';
import { useSupabaseAuth } from '@/contexts/SupabaseAuthContext';
import { useStore } from '@/contexts/StoreContext';
import { isSuperAdminRole } from '@/lib/permissions';
import { PinEntry } from '@/components/pos/PinEntry';
import type { Company, Staff } from '@/types/pos';

export default function CompanyManagementPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [selectedCompany, setSelectedCompany] = useState<Company | null>(null);
  const [stores, setStores] = useState<Store[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateCompany, setShowCreateCompany] = useState(false);
  const [showEditCompany, setShowEditCompany] = useState(false);
  const [showCreateStore, setShowCreateStore] = useState(false);
  const [showStoreCode, setShowStoreCode] = useState<Store | null>(null);
  const [unassignedStores, setUnassignedStores] = useState<Store[]>([]);
  const [selectedStoreIds, setSelectedStoreIds] = useState<string[]>([]);
  const [showAddStaff, setShowAddStaff] = useState(false);
  const [showEditStaff, setShowEditStaff] = useState(false);
  const [editingStaff, setEditingStaff] = useState<Staff | null>(null);
  const [addingStaff, setAddingStaff] = useState(false);
  const [showDeletePin, setShowDeletePin] = useState(false);
  const [companyPendingDelete, setCompanyPendingDelete] = useState<Company | null>(null);
  const [deletePinError, setDeletePinError] = useState('');
  const [deletingCompany, setDeletingCompany] = useState(false);
  const [staffForm, setStaffForm] = useState({
    name: '',
    email: '',
    employeePin: '',
    role: 'salesperson' as Staff['role'],
    storeId: '',
  });
  const navigate = useNavigate();
  const { settings } = useSupabaseAuth();
  const { setCurrentStoreId } = useStore();
  const isSuperAdmin = isSuperAdminRole(settings?.userRole);

  // Company form state
  const [companyForm, setCompanyForm] = useState({
    name: '',
    ownerPhone: '',
    ownerPin: '',
    phone: '',
    email: '',
    address: '',
    currency: 'ZMW',
    currencySymbol: 'K',
    parallel_enabled: false,
    parallel_source: 'mthunzi_pos' as 'mthunzi_pos' | 'external_pos',
    parallel_status: 'disabled',
    dashboard_user_limit: 0,
  });

  // Store form state
  const [storeForm, setStoreForm] = useState({
    name: '',
    location_name: '',
    category: '',
    address: '',
    phone: '',
    currency: 'ZMW',
    currency_symbol: 'K',
    is_public: true,
  });
  const [onboardingCompanyId, setOnboardingCompanyId] = useState<string | null>(null);
  const [onboardingStoreId, setOnboardingStoreId] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, [settings?.companyId, settings?.userRole]);

  const loadData = async () => {
    try {
      setLoading(true);
      const companiesData = await listCompaniesForCurrentUser({
        companyId: settings?.companyId,
        userRole: settings?.userRole,
      });

      setCompanies(companiesData);

      if (companiesData.length > 0) {
        const preferred =
          companiesData.find((c) => String(c.id) === String(settings?.companyId)) ||
          companiesData[0];
        setSelectedCompany(preferred);
        await loadCompanyData(preferred.id);
      } else {
        setSelectedCompany(null);
        setStores([]);
        setStaff([]);
      }
    } catch (error) {
      console.error('Failed to load data:', error);
      toast.error('Failed to load company data');
    } finally {
      setLoading(false);
    }
  };

  const loadUnassignedStores = async () => {
    try {
      const unassigned = await getUnassignedStores();
      setUnassignedStores(unassigned);
    } catch (error) {
      console.error('Failed to load unassigned stores:', error);
    }
  };

  const getStoreLabel = (storeId?: string) => {
    if (!storeId) return 'Company-level access';
    const store = stores.find((item) => item.id === storeId);
    return store ? `${store.name}${store.location_name ? ` — ${store.location_name}` : ''}` : 'Unknown branch';
  };

  const handleAddStaff = async () => {
    if (!selectedCompany) {
      toast.error('Select a company before adding staff');
      return;
    }
    const needsStore = staffForm.role !== 'owner' && staffForm.role !== 'manager';
    if (!staffForm.name.trim() || !staffForm.email.trim() || !staffForm.employeePin.trim()) {
      toast.error('Name, email and staff PIN are required to add a staff member');
      return;
    }

    if (needsStore && !staffForm.storeId) {
      toast.error('Please assign a store for this staff member');
      return;
    }

    try {
      setAddingStaff(true);
      const emailValue = normalizeEmail(staffForm.email.trim());
      if (!emailValue) {
        toast.error('Enter a valid email address');
        return;
      }

      const phoneValue = staffForm.phone.trim() ? (normalizePhone(staffForm.phone.trim()) || staffForm.phone.trim()) : undefined;

      const newStaff = await addStaff({
        companyId: selectedCompany.id,
        storeId: staffForm.storeId || undefined,
        name: staffForm.name.trim(),
        phone: phoneValue,
        email: emailValue,
        role: staffForm.role,
        employeePin: staffForm.employeePin.trim(),
        isManager: staffForm.role === 'owner' || staffForm.role === 'manager',
      });

      setStaff((prev) => [...prev, newStaff]);
      setShowAddStaff(false);
      setStaffForm({ name: '', phone: '', employeePin: '', role: 'salesperson', storeId: '' });
      toast.success('Staff member added successfully');

      // If we are in onboarding flow (created company -> store -> staff), set current store and open POS
      if (onboardingStoreId) {
        try {
          if (setCurrentStoreId && onboardingStoreId) {
            setCurrentStoreId(onboardingStoreId);
          }
        } catch (e) {
          console.warn('Failed to set current store during onboarding:', e);
        }
        setOnboardingCompanyId(null);
        setOnboardingStoreId(null);
        navigate('/');
      }
    } catch (error) {
      console.error('Failed to add staff:', error);
      toast.error('Unable to add staff member');
    } finally {
      setAddingStaff(false);
    }
  };

  const handleEditStaff = (staffMember: Staff) => {
    setEditingStaff(staffMember);
    setStaffForm({
      name: staffMember.name,
      email: staffMember.email || '',
      employeePin: staffMember.employeePin || '',
      role: staffMember.role,
      storeId: staffMember.storeId || '',
    });
    setShowEditStaff(true);
  };

  const handleUpdateStaff = async () => {
    if (!editingStaff) return;

    try {
      const emailValue = normalizeEmail(staffForm.email.trim());
      const updatedStaff = await updateStaff(editingStaff.id, {
        name: staffForm.name.trim(),
        email: emailValue,
        role: staffForm.role,
        employeePin: staffForm.employeePin.trim(),
        storeId: staffForm.storeId || undefined,
        isManager: staffForm.role === 'owner' || staffForm.role === 'manager',
      });

      setStaff((prev) => prev.map((s) => (s.id === updatedStaff.id ? updatedStaff : s)));
      setShowEditStaff(false);
      setEditingStaff(null);
      setStaffForm({ name: '', phone: '', employeePin: '', role: 'salesperson', storeId: '' });
      toast.success('Staff member updated successfully');
    } catch (error) {
      console.error('Failed to update staff:', error);
      toast.error('Unable to update staff member');
    }
  };

  const handleDeleteStaff = async (staffId: string) => {
    if (!window.confirm('Are you sure you want to delete this staff member?')) {
      return;
    }

    try {
      await deleteStaff(staffId);
      setStaff((prev) => prev.filter((s) => s.id !== staffId));
      toast.success('Staff member deleted successfully');
    } catch (error) {
      console.error('Failed to delete staff:', error);
      toast.error('Unable to delete staff member');
    }
  };

  const handleSyncToSupabase = async () => {
    if (!isSuperAdmin) {
      toast.error('Only platform admins can sync all companies');
      return;
    }
    if (!window.confirm('This will sync all your local companies, stores, and staff to Supabase. This may take a few minutes. Continue?')) {
      return;
    }

    try {
      toast.loading('Syncing data to Supabase...');
      await syncToSupabase();
      toast.dismiss();
      toast.success('Data synced to Supabase successfully');
    } catch (error) {
      console.error('Failed to sync to Supabase:', error);
      toast.dismiss();
      toast.error('Failed to sync to Supabase. Check console for details.');
    }
  };

  const loadCompanyData = async (companyId: string) => {
    try {
      const [storesData, staffData] = await Promise.all([
        getCompanyStores(companyId),
        getCompanyStaff(companyId),
      ]);
      // `getCompanyStores` may return an array or a wrapper object depending on implementation.
      const storesArray = Array.isArray(storesData) ? storesData : (storesData && (storesData as any).stores ? (storesData as any).stores : []);
      setStores(storesArray);
      setStaff(staffData);
    } catch (error) {
      console.error('Failed to load company data:', error);
      toast.error('Failed to load company details');
    }
  };

  const handleCreateCompany = async () => {
    if (!isSuperAdmin) {
      toast.error('You can only manage your own company');
      return;
    }
    if (!companyForm.name || !companyForm.ownerPhone) {
      toast.error('Company name and owner phone are required');
      return;
    }

    try {
      // Prefer Supabase-first creation path so remote rows are created immediately
      const result = await SupabaseFirstService.createCompany({
        name: companyForm.name,
        email: companyForm.email,
        address: companyForm.address,
        currency: companyForm.currency,
        currency_symbol: companyForm.currencySymbol,
      });

      let newCompany: any;
      if (result && result.success && result.company) {
        // Map Supabase row to local Company shape used by the UI
        const remote = result.company as any;
        newCompany = {
          id: remote.id,
          name: remote.name || '',
          ownerId: remote.owner_id || remote.ownerId,
          ownerPhone: remote.owner_phone || remote.ownerPhone,
          ownerPin: remote.owner_pin || remote.ownerPin,
          phone: remote.phone || undefined,
          email: remote.email || remote.owner_email || undefined,
          address: remote.address || undefined,
          logoUrl: remote.logo_url || remote.logoUrl || undefined,
          currency: remote.currency || 'ZMW',
          currencySymbol: remote.currency_symbol || remote.currencySymbol || 'K',
          baseCurrency: remote.base_currency || remote.baseCurrency || 'ZMW',
          plan: remote.plan || 'free',
          userRole: 'owner',
          assignedStoreId: remote.assigned_store_id || remote.assignedStoreId || null,
          taxRate: Number(remote.tax_rate || 0) || 0,
          salesTaxMode: remote.sales_tax_mode || 'none',
          salesTaxRate: Number(remote.sales_tax_rate || 0) || 0,
          singleItemMarginPercent: Number(remote.single_item_margin_percent || 0) || 0,
          receiptFooter: remote.receipt_footer || '',
          thermalPrinterWidth: remote.thermal_printer_width || '58mm',
          adminPin: remote.admin_pin || null,
          pinSetupComplete: Boolean(remote.pin_setup_complete || false),
          isActive: remote.is_active === false ? false : true,
          createdAt: remote.created_at ? new Date(remote.created_at) : new Date(),
          updatedAt: remote.updated_at ? new Date(remote.updated_at) : new Date(),
        };
      } else {
        // Fallback to local create path
        newCompany = await createCompany({
          name: companyForm.name,
          ownerPhone: companyForm.ownerPhone,
          ownerPin: companyForm.ownerPin,
          phone: companyForm.phone,
          email: companyForm.email,
          address: companyForm.address,
          currency: companyForm.currency,
          currencySymbol: companyForm.currencySymbol,
        });
      }

      let storeAssignmentSuccess = true;
      if (selectedStoreIds.length > 0) {
        try {
          await assignStoresToCompany(newCompany.id, selectedStoreIds);
        } catch (error) {
          storeAssignmentSuccess = false;
          console.error('Failed to assign stores to company:', error);
          toast.error('Company created, but failed to assign selected stores.');
        }
      }

      setCompanies((prev) => {
        // Super admin can accumulate companies; owners stay at one.
        if (!isSuperAdmin) return [newCompany];
        if (prev.some((c) => c.id === newCompany.id)) return prev;
        return [...prev, newCompany];
      });
      setSelectedCompany(newCompany);

      try {
        await loadCompanyData(newCompany.id);
      } catch (error) {
        console.warn('Company created, but loading company data failed:', error);
        toast.error('Company created, but failed to load company details.');
      }

      // If no stores were selected during company creation, begin onboarding by opening the Create Store dialog
      if (selectedStoreIds.length === 0) {
        setOnboardingCompanyId(newCompany.id);
        setShowCreateStore(true);
        setStoreForm((prev) => ({ ...prev, name: `${newCompany.name} - Main`, phone: newCompany.ownerPhone || '' }));
      }

      if (selectedStoreIds.length > 0 && storeAssignmentSuccess) {
        toast.success(`Company created and ${selectedStoreIds.length} store(s) assigned!`);
      } else if (selectedStoreIds.length === 0) {
        toast.success('Company created successfully!');
      }

      setShowCreateCompany(false);
      setSelectedStoreIds([]);
      setUnassignedStores([]);
      setCompanyForm({
        name: '',
        ownerPhone: '',
        ownerPin: '',
        phone: '',
        email: '',
        address: '',
        currency: 'ZMW',
        currencySymbol: 'K',
      });
    } catch (error) {
      console.error('Failed to create company:', error);
      toast.error(`Failed to create company: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const handleOpenCreateCompany = async () => {
    await loadUnassignedStores();
    setShowCreateCompany(true);
  };

  const handleEditCompany = async () => {
    if (!selectedCompany) return;

    try {
      const updated = await updateCompany(selectedCompany.id, {
        name: companyForm.name || selectedCompany.name,
        ownerPhone: companyForm.ownerPhone || selectedCompany.ownerPhone,
        ownerPin: companyForm.ownerPin || selectedCompany.ownerPin,
        phone: companyForm.phone || selectedCompany.phone,
        email: companyForm.email || selectedCompany.email,
        address: companyForm.address || selectedCompany.address,
        currency: companyForm.currency || selectedCompany.currency,
        currencySymbol: companyForm.currencySymbol || selectedCompany.currencySymbol,
        parallel_enabled: companyForm.parallel_enabled,
        parallel_source: companyForm.parallel_source,
        parallel_status: companyForm.parallel_status,
        dashboard_user_limit: Number(companyForm.dashboard_user_limit || 0),
      });

      setCompanies(prev => prev.map(c => c.id === updated.id ? updated : c));
      setSelectedCompany(updated);
      setShowEditCompany(false);
      toast.success('Company updated successfully!');
    } catch (error) {
      console.error('Failed to update company:', error);
      toast.error('Failed to update company');
    }
  };

  const requestDeleteCompany = (company: Company) => {
    setSelectedCompany(company);
    setCompanyPendingDelete(company);
    setDeletePinError('');
    setShowDeletePin(true);
  };

  const handleDeletePinSubmit = async (pin: string) => {
    if (!companyPendingDelete) return;

    const expectedPins = [
      companyPendingDelete.ownerPin,
      companyPendingDelete.adminPin,
      settings?.adminPin,
    ]
      .map((p) => (p == null ? '' : String(p).trim()))
      .filter(Boolean);

    if (expectedPins.length === 0) {
      setDeletePinError('No owner PIN is set for this company. Set an owner PIN before deleting.');
      return;
    }

    if (!expectedPins.includes(String(pin).trim())) {
      setDeletePinError('Incorrect PIN. Enter your owner PIN twice to confirm delete.');
      return;
    }

    try {
      setDeletingCompany(true);
      await deleteCompany(companyPendingDelete.id);
      setCompanies((prev) => prev.filter((c) => c.id !== companyPendingDelete.id));
      if (selectedCompany?.id === companyPendingDelete.id) {
        setSelectedCompany(null);
        setStores([]);
        setStaff([]);
      }
      setShowDeletePin(false);
      setCompanyPendingDelete(null);
      setDeletePinError('');
      toast.success('Company deleted successfully!');
    } catch (error) {
      console.error('Failed to delete company:', error);
      setDeletePinError('Failed to delete company');
      toast.error('Failed to delete company');
    } finally {
      setDeletingCompany(false);
    }
  };

  const handleOpenEditCompany = () => {
    if (!selectedCompany) return;
    setCompanyForm({
      name: selectedCompany.name,
      ownerPhone: selectedCompany.ownerPhone || '',
      ownerPin: selectedCompany.ownerPin || '',
      phone: selectedCompany.phone || '',
      email: selectedCompany.email || '',
      address: selectedCompany.address || '',
      currency: selectedCompany.currency,
      currencySymbol: selectedCompany.currencySymbol,
      parallel_enabled: selectedCompany.parallel_enabled ?? false,
      parallel_source: selectedCompany.parallel_source ?? 'mthunzi_pos',
      parallel_status: selectedCompany.parallel_status || 'disabled',
      dashboard_user_limit: selectedCompany.dashboard_user_limit ?? 0,
    });
    setShowEditCompany(true);
  };

  const handleCreateStore = async () => {
    if (!selectedCompany || !storeForm.name) {
      toast.error('Store name is required');
      return;
    }

    try {
      const result = await createCompanyStore({
        name: storeForm.name,
        location_name: storeForm.location_name,
        category: storeForm.category,
        address: storeForm.address,
        phone: storeForm.phone,
        currency: storeForm.currency,
        currency_symbol: storeForm.currency_symbol,
        is_public: storeForm.is_public,
      }, selectedCompany.id);

      if (!result || !result.success) {
        throw new Error(result?.error || 'Failed to create store');
      }

      const newStore = result.store;
      if (newStore) setStores(prev => [...prev, newStore]);
      setShowCreateStore(false);
      // If we're in onboarding flow, open add-staff dialog and prefill owner info
      if (onboardingCompanyId && selectedCompany && onboardingCompanyId === selectedCompany.id) {
        setOnboardingStoreId(newStore?.id || null);
        setStaffForm((prev) => ({
          ...prev,
          name: selectedCompany.name || prev.name,
          phone: selectedCompany.ownerPhone || prev.phone,
          role: 'owner',
          storeId: newStore?.id || '',
        }));
        setShowAddStaff(true);
      }
      setStoreForm({
        name: '',
        location_name: '',
        category: '',
        address: '',
        phone: '',
        currency: 'ZMW',
        currency_symbol: 'K',
        is_public: true,
      });
      if ((result as any).queued) {
        toast.success('Store created locally; will sync when online');
      } else {
        toast.success('Store created successfully!');
      }
    } catch (error) {
      console.error('Failed to create store:', error);
      toast.error('Failed to create store');
    }
  };

  const handleDeleteStore = async (storeId: string) => {
    if (!confirm('Are you sure you want to delete this store? This action cannot be undone.')) {
      return;
    }

    try {
      await deleteCompanyStore(storeId);
      setStores(prev => prev.filter(store => store.id !== storeId));
      toast.success('Store deleted successfully!');
    } catch (error) {
      console.error('Failed to delete store:', error);
      toast.error('Failed to delete store');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
          <p className="mt-4 text-muted-foreground">Loading company data...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Company Management</h1>
          <p className="text-muted-foreground">
            {isSuperAdmin
              ? 'Manage all companies and stores (platform admin)'
              : 'Manage your company and stores'}
          </p>
        </div>
        <div className="flex gap-3">
          <Button variant="outline" onClick={() => navigate('/admin')}>
            <Home className="mr-2 h-4 w-4" />
            Home
          </Button>
          {isSuperAdmin && (
          <Dialog open={showCreateCompany} onOpenChange={(open) => { if (open) handleOpenCreateCompany(); else setShowCreateCompany(false); }}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                New Company
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Create New Company</DialogTitle>
                <DialogDescription>
                  Create a new company to manage multiple stores
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="company-name">Company Name</Label>
                  <Input
                    id="company-name"
                    value={companyForm.name}
                    onChange={(e) => setCompanyForm(prev => ({ ...prev, name: e.target.value }))}
                    placeholder="e.g., Company Chacha"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="owner-phone">Owner Phone</Label>
                  <Input
                    id="owner-phone"
                    type="tel"
                    value={companyForm.ownerPhone}
                    onChange={(e) => setCompanyForm(prev => ({ ...prev, ownerPhone: e.target.value }))}
                    placeholder="0971112222"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="owner-pin">Owner PIN</Label>
                  <Input
                    id="owner-pin"
                    type="password"
                    value={companyForm.ownerPin}
                    onChange={(e) => setCompanyForm(prev => ({ ...prev, ownerPin: e.target.value }))}
                    placeholder="4-6 digit PIN"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="company-email">Email</Label>
                  <Input
                    id="company-email"
                    type="email"
                    value={companyForm.email}
                    onChange={(e) => setCompanyForm(prev => ({ ...prev, email: e.target.value }))}
                    placeholder="company@example.com"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="company-address">Address</Label>
                  <Textarea
                    id="company-address"
                    value={companyForm.address}
                    onChange={(e) => setCompanyForm(prev => ({ ...prev, address: e.target.value }))}
                    placeholder="Company address"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="currency">Currency</Label>
                    <Select value={companyForm.currency} onValueChange={(value) => setCompanyForm(prev => ({ ...prev, currency: value }))}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ZMW">ZMW</SelectItem>
                        <SelectItem value="USD">USD</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="currency-symbol">Symbol</Label>
                    <Input
                      id="currency-symbol"
                      value={companyForm.currencySymbol}
                      onChange={(e) => setCompanyForm(prev => ({ ...prev, currencySymbol: e.target.value }))}
                      placeholder="K"
                    />
                  </div>
                </div>

                {/* Unassigned Stores Selection */}
                <div className="space-y-3 pt-4 border-t">
                  <div className="flex items-center justify-between">
                    <Label>Assign Existing Stores</Label>
                    <span className="text-sm text-muted-foreground">
                      {unassignedStores.length > 0 ? `${selectedStoreIds.length} selected` : 'No unassigned stores'}
                    </span>
                  </div>
                  {unassignedStores.length > 0 ? (
                    <div className="max-h-48 overflow-y-auto space-y-2">
                      {unassignedStores.map((store) => (
                        <div key={store.id} className="flex items-center gap-3 p-2 border rounded hover:bg-muted/50">
                          <input
                            type="checkbox"
                            id={`store-${store.id}`}
                            checked={selectedStoreIds.includes(store.id)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedStoreIds(prev => [...prev, store.id]);
                              } else {
                                setSelectedStoreIds(prev => prev.filter(id => id !== store.id));
                              }
                            }}
                            className="h-4 w-4"
                          />
                          <label htmlFor={`store-${store.id}`} className="flex-1 cursor-pointer">
                            <div className="font-medium">{store.name}</div>
                            {store.address && (
                              <div className="text-sm text-muted-foreground">{store.address}</div>
                            )}
                          </label>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      No existing stores available to assign. Create stores first, then they will appear here.
                    </p>
                  )}
                </div>

                <div className="flex gap-3 pt-4">
                  <Button variant="outline" onClick={() => setShowCreateCompany(false)}>
                    Cancel
                  </Button>
                  <Button onClick={handleCreateCompany} className="flex-1">
                    Create Company
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
          )}

          {/* Edit Company Dialog */}
          <Dialog open={showEditCompany} onOpenChange={setShowEditCompany}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Edit Company</DialogTitle>
                <DialogDescription>
                  Update company information for {selectedCompany?.name}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="edit-company-name">Company Name</Label>
                  <Input
                    id="edit-company-name"
                    value={companyForm.name}
                    onChange={(e) => setCompanyForm(prev => ({ ...prev, name: e.target.value }))}
                    placeholder="Company name"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-owner-phone">Owner Phone</Label>
                  <Input
                    id="edit-owner-phone"
                    value={companyForm.ownerPhone}
                    onChange={(e) => setCompanyForm(prev => ({ ...prev, ownerPhone: e.target.value }))}
                    placeholder="e.g., 0971112222"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-owner-pin">Owner PIN</Label>
                  <Input
                    id="edit-owner-pin"
                    type="password"
                    value={companyForm.ownerPin}
                    onChange={(e) => setCompanyForm(prev => ({ ...prev, ownerPin: e.target.value }))}
                    placeholder="4-6 digit PIN"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-company-phone">Phone</Label>
                  <Input
                    id="edit-company-phone"
                    value={companyForm.phone}
                    onChange={(e) => setCompanyForm(prev => ({ ...prev, phone: e.target.value }))}
                    placeholder="Company phone"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-company-email">Email</Label>
                  <Input
                    id="edit-company-email"
                    type="email"
                    value={companyForm.email}
                    onChange={(e) => setCompanyForm(prev => ({ ...prev, email: e.target.value }))}
                    placeholder="company@example.com"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-company-address">Address</Label>
                  <Textarea
                    id="edit-company-address"
                    value={companyForm.address}
                    onChange={(e) => setCompanyForm(prev => ({ ...prev, address: e.target.value }))}
                    placeholder="Company address"
                  />
                </div>
                {settings?.userRole === 'super_admin' && (
                  <div className="space-y-4 rounded border border-muted p-4 bg-muted/50">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="text-sm font-semibold">Parallel Settings</p>
                        <p className="text-xs text-muted-foreground">
                          Hidden super admin-only settings for Parallel feature flags.
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Label htmlFor="parallel-enabled" className="text-sm">Enable</Label>
                        <Input
                          id="parallel-enabled"
                          type="checkbox"
                          checked={companyForm.parallel_enabled}
                          onChange={(e) => setCompanyForm(prev => ({ ...prev, parallel_enabled: e.target.checked }))}
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-2">
                        <Label htmlFor="parallel-source">Parallel Source</Label>
                        <Select
                          value={companyForm.parallel_source}
                          onValueChange={(value) => setCompanyForm(prev => ({ ...prev, parallel_source: value as 'mthunzi_pos' | 'external_pos' }))}
                        >
                          <SelectTrigger id="parallel-source">
                            <SelectValue placeholder="Select source" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="mthunzi_pos">Mthunzi POS</SelectItem>
                            <SelectItem value="external_pos">External POS</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="dashboard-user-limit">Dashboard User Limit</Label>
                        <Input
                          id="dashboard-user-limit"
                          type="number"
                          min={0}
                          value={companyForm.dashboard_user_limit}
                          onChange={(e) => setCompanyForm(prev => ({ ...prev, dashboard_user_limit: Number(e.target.value) }))}
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-2">
                        <Label>Parallel Status</Label>
                        <Input
                          readOnly
                          value={companyForm.parallel_status}
                          placeholder="disabled"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Effective Mode</Label>
                        <Input
                          readOnly
                          value={companyForm.parallel_source === 'external_pos' ? 'External ingestion active' : 'Internal POS data active'}
                        />
                      </div>
                    </div>
                  </div>
                )}
                <div className="flex gap-3 pt-4">
                  <Button variant="outline" onClick={() => setShowEditCompany(false)}>
                    Cancel
                  </Button>
                  <Button onClick={handleEditCompany} className="flex-1">
                    Update Company
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Company Selector */}
      {companies.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Building2 className="h-5 w-5" />
                {isSuperAdmin ? 'Select Company' : 'Your Company'}
              </div>
              {!isSuperAdmin && (
                <span className="text-xs font-normal text-muted-foreground">
                  Locked to this device
                </span>
              )}
              {isSuperAdmin && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleSyncToSupabase}
                className="flex items-center gap-2"
              >
                <Cloud className="h-4 w-4" />
                Sync to Supabase
              </Button>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {companies.map((company) => (
                <div
                  key={company.id}
                  className={`p-4 border rounded-lg transition-colors ${
                    selectedCompany?.id === company.id
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:bg-muted/50'
                  }`}
                >
                  <div className="flex items-start justify-between mb-2">
                    <div
                      className="flex-1 cursor-pointer"
                      onClick={() => {
                        setSelectedCompany(company);
                        loadCompanyData(company.id);
                      }}
                    >
                      <h3 className="font-semibold">{company.name}</h3>
                      <div className="flex items-center gap-2 text-sm text-muted-foreground mt-1">
                        <Phone className="h-3 w-3" />
                        {company.ownerPhone}
                      </div>
                      {company.email && (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground mt-1">
                          <Mail className="h-3 w-3" />
                          {company.email}
                        </div>
                      )}
                    </div>
                    <Badge variant={company.isActive ? 'default' : 'secondary'}>
                      {company.isActive ? 'Active' : 'Inactive'}
                    </Badge>
                  </div>
                  <div className="flex gap-2 mt-3">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedCompany(company);
                        handleOpenEditCompany();
                      }}
                    >
                      <Edit className="h-3 w-3 mr-1" />
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={(e) => {
                        e.stopPropagation();
                        requestDeleteCompany(company);
                      }}
                    >
                      <Trash2 className="h-3 w-3 mr-1" />
                      Delete
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Company Details */}
      {selectedCompany && (
        <Tabs defaultValue="stores" className="space-y-4">
          <TabsList>
            <TabsTrigger value="stores">Stores</TabsTrigger>
            <TabsTrigger value="staff">Staff</TabsTrigger>
            <TabsTrigger value="settings">Settings</TabsTrigger>
          </TabsList>

          <TabsContent value="stores">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2">
                    <Store className="h-5 w-5" />
                    Stores ({stores.length})
                  </CardTitle>
                  <div className="flex gap-2">
                    {isSuperAdmin && (
                    <Button
                      variant="outline"
                      onClick={async () => {
                        await loadUnassignedStores();
                        setShowCreateCompany(true);
                        toast.info('Select stores to assign to this company');
                      }}
                    >
                      <Store className="mr-2 h-4 w-4" />
                      Assign Existing Store
                    </Button>
                    )}
                    <Dialog open={showCreateStore} onOpenChange={setShowCreateStore}>
                      <DialogTrigger asChild>
                        <Button>
                          <Plus className="mr-2 h-4 w-4" />
                          Add Store
                        </Button>
                      </DialogTrigger>
                      <DialogContent className="sm:max-w-md">
                        <DialogHeader>
                          <DialogTitle>Create New Store</DialogTitle>
                          <DialogDescription>
                            Add a new store to {selectedCompany.name}
                          </DialogDescription>
                        </DialogHeader>
                      <div className="space-y-4">
                        <div className="space-y-2">
                          <Label htmlFor="store-name">Store Name</Label>
                          <Input
                            id="store-name"
                            value={storeForm.name}
                            onChange={(e) => setStoreForm(prev => ({ ...prev, name: e.target.value }))}
                            placeholder="e.g., Chacha Main Store"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="location-name">Location Name</Label>
                          <Input
                            id="location-name"
                            value={storeForm.location_name}
                            onChange={(e) => setStoreForm(prev => ({ ...prev, location_name: e.target.value }))}
                            placeholder="e.g., Ndola Main Branch"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="store-category">Category</Label>
                          <Select value={storeForm.category} onValueChange={(value) => setStoreForm(prev => ({ ...prev, category: value }))}>
                            <SelectTrigger>
                              <SelectValue placeholder="Select category" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="retail">Retail</SelectItem>
                              <SelectItem value="restaurant">Restaurant</SelectItem>
                              <SelectItem value="wholesale">Wholesale</SelectItem>
                              <SelectItem value="service">Service</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="store-address">Address</Label>
                          <Textarea
                            id="store-address"
                            value={storeForm.address}
                            onChange={(e) => setStoreForm(prev => ({ ...prev, address: e.target.value }))}
                            placeholder="Store address"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="store-phone">Phone</Label>
                          <Input
                            id="store-phone"
                            type="tel"
                            value={storeForm.phone}
                            onChange={(e) => setStoreForm(prev => ({ ...prev, phone: e.target.value }))}
                            placeholder="Store phone number"
                          />
                        </div>
                        <div className="flex gap-3 pt-4">
                          <Button variant="outline" onClick={() => setShowCreateStore(false)}>
                            Cancel
                          </Button>
                          <Button onClick={handleCreateStore} className="flex-1">
                            Create Store
                          </Button>
                        </div>
                      </div>
                    </DialogContent>
                  </Dialog>
                </div>
                </div>
              </CardHeader>
              <CardContent>
                {stores.length === 0 ? (
                  <div className="text-center py-8">
                    <Store className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                    <h3 className="text-lg font-semibold mb-2">No stores yet</h3>
                    <p className="text-muted-foreground mb-4">Create your first store to get started</p>
                    <Button onClick={() => setShowCreateStore(true)}>
                      <Plus className="mr-2 h-4 w-4" />
                      Create Store
                    </Button>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {stores.map((store) => (
                      <div key={store.id} className="border rounded-lg p-4 space-y-3">
                        <div className="flex items-start justify-between">
                          <div>
                            <h3 className="font-semibold">{store.name}</h3>
                            {store.location_name && (
                              <p className="text-sm text-muted-foreground">{store.location_name}</p>
                            )}
                          </div>
                          <div className="flex gap-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setShowStoreCode(store)}
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleDeleteStore(store.id)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                        
                        {store.address && (
                          <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <MapPin className="h-3 w-3" />
                            {store.address}
                          </div>
                        )}
                        
                        {store.phone && (
                          <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <Phone className="h-3 w-3" />
                            {store.phone}
                          </div>
                        )}
                        
                        <div className="flex gap-2">
                          <Badge variant={store.is_public ? 'default' : 'secondary'}>
                            {store.is_public ? 'Public' : 'Private'}
                          </Badge>
                          {store.category && (
                            <Badge variant="outline">{store.category}</Badge>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="staff">
            <Card>
              <CardHeader>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <CardTitle className="flex items-center gap-2">
                    <Users className="h-5 w-5" />
                    Staff Members ({staff.length})
                  </CardTitle>
                  <Button onClick={() => setShowAddStaff(true)}>
                    <Plus className="mr-2 h-4 w-4" />
                    Add Staff
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {staff.length === 0 ? (
                  <div className="text-center py-8">
                    <Users className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                    <h3 className="text-lg font-semibold mb-2">No staff members yet</h3>
                    <p className="text-muted-foreground">Add staff members to manage your stores</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {staff.map((staffMember) => (
                      <div key={staffMember.id} className="flex items-center justify-between p-4 border rounded-lg">
                        <div>
                          <h4 className="font-semibold">{staffMember.name}</h4>
                          <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
                            <span>{staffMember.role}</span>
                            <span>{staffMember.phone}</span>
                            <span>{staffMember.email}</span>
                            <span>{getStoreLabel(staffMember.storeId)}</span>
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <Badge variant={staffMember.isActive ? 'default' : 'secondary'}>
                            {staffMember.isActive ? 'Active' : 'Inactive'}
                          </Badge>
                          {staffMember.isManager && (
                            <Badge variant="outline">Manager</Badge>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleEditStaff(staffMember)}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleDeleteStaff(staffMember.id)}
                          >
                            <Trash2 className="h-4 w-4 text-red-500" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="settings">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Settings className="h-5 w-5" />
                  Company Settings
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <Alert>
                    <AlertDescription>
                      Company settings and configuration options will be available here.
                    </AlertDescription>
                  </Alert>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}

      {/* Delete Company — require owner PIN entered twice */}
      {showDeletePin && companyPendingDelete && (
        <div className="fixed inset-0 z-50 bg-background">
          <PinEntry
            isSetup
            title="Confirm Company Delete"
            subtitle={`Enter your owner PIN twice to permanently delete ${companyPendingDelete.name}. This cannot be undone.`}
            error={deletePinError || (deletingCompany ? 'Deleting…' : undefined)}
            onSubmit={handleDeletePinSubmit}
            onCancel={() => {
              if (deletingCompany) return;
              setShowDeletePin(false);
              setCompanyPendingDelete(null);
              setDeletePinError('');
            }}
          />
        </div>
      )}

      {/* Store Code Dialog */}
      <Dialog open={!!showStoreCode} onOpenChange={() => setShowStoreCode(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Store Join Code</DialogTitle>
            <DialogDescription>
              Share this code with staff to allow them to join this store
            </DialogDescription>
          </DialogHeader>
          {showStoreCode && (
            <div className="space-y-4">
              <div className="text-center">
                <div className="text-2xl font-bold font-mono bg-muted p-4 rounded-lg">
                  {showStoreCode.store_code || 'SHOP-' + showStoreCode.id?.slice(-5).toUpperCase()}
                </div>
                <p className="text-sm text-muted-foreground mt-2">
                  Store: {showStoreCode.name}
                </p>
              </div>
              <div className="flex gap-3">
                <Button variant="outline" onClick={() => setShowStoreCode(null)}>
                  Close
                </Button>
                <Button
                  onClick={() => {
                    navigator.clipboard.writeText(showStoreCode.store_code || 'SHOP-' + showStoreCode.id?.slice(-5).toUpperCase());
                    toast.success('Store code copied to clipboard!');
                  }}
                  className="flex-1"
                >
                  Copy Code
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Add Staff Dialog */}
      <Dialog open={showAddStaff} onOpenChange={setShowAddStaff}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Add Staff Member</DialogTitle>
            <DialogDescription>
              Add staff under the selected company and choose the role they should operate with.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="staff-name">Name</Label>
              <Input
                id="staff-name"
                value={staffForm.name}
                onChange={(e) => setStaffForm((prev) => ({ ...prev, name: e.target.value }))}
                placeholder="Jane Doe"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="staff-email">Email</Label>
              <Input
                id="staff-email"
                type="email"
                value={staffForm.email}
                onChange={(e) => setStaffForm((prev) => ({ ...prev, email: e.target.value }))}
                placeholder="jane@example.com"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="staff-phone">Phone</Label>
              <Input
                id="staff-phone"
                type="tel"
                value={staffForm.phone}
                onChange={(e) => setStaffForm((prev) => ({ ...prev, phone: e.target.value }))}
                placeholder="0971112222"
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="staff-store">Assign Store</Label>
                <p className="text-sm text-muted-foreground">
                  Choose the store branch this staff member will work at (e.g. Lusaka or Ndola).
                </p>
                <Select value={staffForm.storeId} onValueChange={(value) => setStaffForm((prev) => ({ ...prev, storeId: value }))}>
                  <SelectTrigger id="staff-store">
                    <SelectValue placeholder="Select store" />
                  </SelectTrigger>
                  <SelectContent>
                    {stores.length === 0 ? (
                      <SelectItem value="no-stores" disabled>
                        No stores available
                      </SelectItem>
                    ) : (
                      stores
                        .filter((store) => Boolean(store.id))
                        .map((store) => (
                          <SelectItem key={store.id} value={store.id}>
                            {store.name}{store.location_name ? ` — ${store.location_name}` : ''}
                          </SelectItem>
                        ))
                    )}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="staff-pin">Staff PIN</Label>
                <Input
                  id="staff-pin"
                  type="password"
                  value={staffForm.employeePin}
                  onChange={(e) => setStaffForm((prev) => ({ ...prev, employeePin: e.target.value }))}
                  placeholder="4-6 digit PIN"
                />
              </div>
            </div>
            <div className="flex gap-3 pt-4">
              <Button variant="outline" onClick={() => setShowAddStaff(false)}>
                Cancel
              </Button>
              <Button className="flex-1" onClick={handleAddStaff} disabled={addingStaff}>
                {addingStaff ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Adding...
                  </span>
                ) : (
                  'Add Staff Member'
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Staff Dialog */}
      <Dialog open={showEditStaff} onOpenChange={setShowEditStaff}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Staff Member</DialogTitle>
            <DialogDescription>
              Update staff member information. Changes will sync to Supabase for multi-device access.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-staff-name">Name</Label>
              <Input
                id="edit-staff-name"
                value={staffForm.name}
                onChange={(e) => setStaffForm((prev) => ({ ...prev, name: e.target.value }))}
                placeholder="Jane Doe"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-staff-email">Email</Label>
              <Input
                id="edit-staff-email"
                type="email"
                value={staffForm.email}
                onChange={(e) => setStaffForm((prev) => ({ ...prev, email: e.target.value }))}
                placeholder="jane@example.com"
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="edit-staff-store">Assign Store</Label>
                <Select value={staffForm.storeId} onValueChange={(value) => setStaffForm((prev) => ({ ...prev, storeId: value }))}>
                  <SelectTrigger id="edit-staff-store">
                    <SelectValue placeholder="Select store" />
                  </SelectTrigger>
                  <SelectContent>
                    {stores.length === 0 ? (
                      <SelectItem value="no-stores" disabled>
                        No stores available
                      </SelectItem>
                    ) : (
                      stores
                        .filter((store) => Boolean(store.id))
                        .map((store) => (
                          <SelectItem key={store.id} value={store.id}>
                            {store.name}{store.location_name ? ` — ${store.location_name}` : ''}
                          </SelectItem>
                        ))
                    )}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-staff-pin">Staff PIN</Label>
                <Input
                  id="edit-staff-pin"
                  type="password"
                  value={staffForm.employeePin}
                  onChange={(e) => setStaffForm((prev) => ({ ...prev, employeePin: e.target.value }))}
                  placeholder="4-6 digit PIN"
                />
              </div>
            </div>
            <div className="flex gap-3 pt-4">
              <Button variant="outline" onClick={() => {
                setShowEditStaff(false);
                setEditingStaff(null);
                setStaffForm({ name: '', phone: '', email: '', employeePin: '', role: 'salesperson', storeId: '' });
              }}>
                Cancel
              </Button>
              <Button className="flex-1" onClick={handleUpdateStaff}>
                Update Staff Member
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
