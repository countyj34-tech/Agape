import { useMemo } from 'react';
import { useStore } from '@/contexts/StoreContext';
import { useSupabaseAuth } from '@/contexts/SupabaseAuthContext';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export function StoreSwitcher() {
  const { stores, currentStoreId, setCurrentStoreId, loading } = useStore();
  const { settings } = useSupabaseAuth();
  const navigate = useNavigate();

  const plan = settings?.plan ?? 'free';
  const isPremium = true;

  const options = useMemo(
    () => {
      const base = stores.map((s) => ({
        id: s.id,
        label: s.name,
        description: s.location_name || s.category || undefined,
      }));

      // Premium-only "Global View" option that aggregates across all stores.
      if (isPremium && stores.length > 1) {
        return [
          {
            id: '__all__',
            label: 'All Stores (Global View)',
            description: 'Sum across all branches',
          },
          ...base,
        ];
      }

      return base;
    },
    [stores, isPremium]
  );

  if (loading && stores.length === 0) {
    return (
      <div className="px-3 py-2 text-xs text-muted-foreground">
        Loading stores...
      </div>
    );
  }

  if (options.length === 0) {
    return (
      <div className="space-y-2 px-3 pb-2 pt-1">
        <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <span>Store</span>
          <Badge variant="outline" className="text-[10px]">
            Multi-Store
          </Badge>
        </div>
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>No stores configured yet.</span>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-8 w-8"
            title="Register new branch"
            onClick={() => navigate('/admin/stores')}
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Tap + to register your first branch.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-1 px-3 pb-2 pt-1">
      <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        <span>Store</span>
        <Badge variant="outline" className="text-[10px]">
          Multi-Store
        </Badge>
      </div>
      <div className="flex items-center gap-2">
        <div className="flex-1">
          <Select value={currentStoreId} onValueChange={setCurrentStoreId}>
            <SelectTrigger className="h-9 text-left text-xs">
              <SelectValue placeholder="Select store" />
            </SelectTrigger>
            <SelectContent>
              {options.map((opt) => (
                <SelectItem key={opt.id} value={opt.id} className="text-xs">
                  <div className="flex flex-col">
                    <span className="font-medium">{opt.label}</span>
                    {opt.description && (
                      <span className="text-[10px] text-muted-foreground">{opt.description}</span>
                    )}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-8 w-8"
          title="Register new branch"
          onClick={() => navigate('/admin/stores')}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
