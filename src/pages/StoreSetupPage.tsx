import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, Plus } from 'lucide-react';
import { hasPersistedStoreProfile } from '@/lib/storeProfile';

export default function StoreSetupPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [hasStoreProfile, setHasStoreProfile] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const profileExists = await hasPersistedStoreProfile();
      if (cancelled) return;

      setHasStoreProfile(profileExists);
      setLoading(false);

      if (profileExists) {
        navigate('/', { replace: true });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [navigate]);

  const handleCreate = () => {
    navigate('/admin/stores');
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
        <Card className="w-full max-w-lg">
          <CardContent className="flex items-center justify-center gap-3 py-12 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            Checking store profile...
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
      <Card className="w-full max-w-lg">
        <CardHeader className="text-center space-y-3">
          <div className="flex justify-center mb-2">
            <div className="text-3xl">🏪</div>
          </div>
          <CardTitle className="text-3xl font-bold">Welcome to Mthunzi POS</CardTitle>
          <CardDescription className="text-base">
            {hasStoreProfile ? 'Your store is ready.' : 'Start by creating your first store.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4">
            <button
              onClick={handleCreate}
              className="p-6 rounded-lg border-2 border-gray-200 bg-white text-left transition-all hover:border-blue-300 hover:shadow-lg"
            >
              <div className="flex items-start gap-4">
                <div className="p-3 rounded-lg bg-blue-100">
                  <Plus className="h-6 w-6 text-blue-600" />
                </div>
                <div className="flex-1">
                  <h3 className="font-bold text-lg mb-2">Create New Store</h3>
                  <p className="text-sm text-gray-600 mb-3">
                    Start a new store with your products and inventory
                  </p>
                  <ul className="text-xs text-gray-500 space-y-1">
                    <li>✓ Set up store name & location</li>
                    <li>✓ Add products & categories</li>
                    <li>✓ Generate store code for other devices</li>
                  </ul>
                </div>
              </div>
            </button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
