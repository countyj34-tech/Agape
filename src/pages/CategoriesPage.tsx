import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { AppShell } from '@/components/layout/AppShell';
import { AdminGate } from '@/components/admin/AdminGate';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useStore } from '@/contexts/StoreContext';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { dexieDb, addCategory, updateCategory, getAllCategories } from '@/lib/db';
import { getDeviceStoreId } from '@/lib/supabase';
import type { Category } from '@/types/pos';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { usePersistentForm } from '@/hooks/usePersistentForm';

const ICON_OPTIONS = ['Coffee', 'Cookie', 'Home', 'Heart', 'Milk', 'Package', 'FolderOpen', 'FileText'];

function newCategoryTemplate(order: number, storeId?: string): Category {
  return {
    id: crypto.randomUUID(),
    name: '',
    icon: 'Package',
    color: '#3B82F6',
    order,
    storeId,
    createdAt: new Date(),
  };
}

export default function CategoriesPage() {
  const { currentStoreId } = useStore();
  const activeStoreId = currentStoreId || getDeviceStoreId();
  const categories = useLiveQuery(() => getAllCategories(activeStoreId), [activeStoreId]);
  const [query, setQuery] = useState('');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<'create' | 'edit'>('create');
  const [draft, setDraft] = useState<Category>(() => newCategoryTemplate(1));

  const [categoryDraftPersisted, setCategoryDraftPersisted, clearCategoryDraftPersisted] =
    usePersistentForm<Partial<Category>>('categories:add-category-draft', () => ({}));

  const filtered = useMemo(() => {
    const list = categories ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((c) => c.name.toLowerCase().includes(q));
  }, [categories, query]);

  const openCreate = () => {
    const nextOrder = ((categories ?? []).reduce((m, c) => Math.max(m, c.order), 0) || 0) + 1;
    setEditorMode('create');
    setDraft({ ...newCategoryTemplate(nextOrder, activeStoreId), ...categoryDraftPersisted });
    setEditorOpen(true);
  };

  const openEdit = (c: Category) => {
    setEditorMode('edit');
    setDraft({ ...c });
    setEditorOpen(true);
  };

  const save = async () => {
    if (!draft.name.trim()) {
      toast.error('Category name is required');
      return;
    }

    try {
      const categoryToSave = editorMode === 'create'
        ? { ...draft, storeId: draft.storeId || activeStoreId, createdAt: new Date() }
        : { ...draft };

      if (editorMode === 'create') {
        await addCategory(categoryToSave);
        clearCategoryDraftPersisted();
        toast.success('Category added');
      } else {
        await updateCategory(categoryToSave);
        toast.success('Category updated');
      }
      setEditorOpen(false);
    } catch (e) {
      console.error(e);
      toast.error('Failed to save category');
    }
  };

  const remove = async (c: Category) => {
    if (!confirm(`Delete category ${c.name}?`)) return;

    try {
      await dexieDb.transaction('rw', dexieDb.categories, dexieDb.products, async () => {
        await dexieDb.categories.delete(c.id);
        const products = await dexieDb.products.toArray();
        const affected = products.filter((p) => p.categoryIds.includes(c.id));
        for (const p of affected) {
          await dexieDb.products.put({
            ...p,
            categoryIds: p.categoryIds.filter((id) => id !== c.id),
            updatedAt: new Date(),
          });
        }
      });

      toast.success('Category deleted');
    } catch (e) {
      console.error(e);
      toast.error('Failed to delete category');
    }
  };

  return (
    <AdminGate>
      <AppShell title="Categories">
        <div className="space-y-4 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex-1">
              <Input
                placeholder="Search categories…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <Button onClick={openCreate} className="gap-2">
              <Plus className="h-4 w-4" />
              Add Category
            </Button>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Categories</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 max-h-[55vh] overflow-y-auto pr-1">
              {(filtered ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">No categories found.</p>
              ) : (
                filtered.map((c) => (
                  <div key={c.id} className="flex items-center justify-between gap-3 rounded-md border p-3 bg-white">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="h-3 w-3 rounded-full" style={{ backgroundColor: c.color }} />
                        <p className="truncate font-semibold">{c.name}</p>
                      </div>
                      <p className="text-xs text-muted-foreground">Icon: {c.icon} • Order: {c.order}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="icon" onClick={() => openEdit(c)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-destructive hover:bg-destructive/10"
                        onClick={() => remove(c)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>

        <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>{editorMode === 'create' ? 'Add Category' : 'Edit Category'}</DialogTitle>
              <DialogDescription className="sr-only">
                Create or edit a category used to group products.
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label>Name</Label>
                <Input
                  value={draft.name}
                  onChange={(e) => setDraft((prev) => ({ ...prev, name: e.target.value }))}
                  placeholder="Category name"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-2">
                  <Label>Icon</Label>
                  <Select
                    value={draft.icon}
                    onValueChange={(v) => setDraft((prev) => ({ ...prev, icon: v }))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select icon" />
                    </SelectTrigger>
                    <SelectContent>
                      {ICON_OPTIONS.map((i) => (
                        <SelectItem key={i} value={i}>
                          {i}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid gap-2">
                  <Label>Order</Label>
                  <Input
                    type="number"
                    inputMode="numeric"
                    value={draft.order === 0 ? '' : String(draft.order)}
                    onChange={(e) => {
                      const raw = e.target.value;
                      const n = parseInt(raw) || 0;
                      setDraft((prev) => ({ ...prev, order: n }));
                      if (editorMode === 'create') {
                        setCategoryDraftPersisted((prev) => ({ ...prev, order: n || undefined }));
                      }
                    }}
                    onFocus={(e) => e.target.select()}
                  />
                </div>
              </div>

              <div className="grid gap-2">
                <Label>Color</Label>
                <Input
                  type="color"
                  value={draft.color}
                  onChange={(e) => setDraft((prev) => ({ ...prev, color: e.target.value }))}
                  className="h-10 px-2"
                />
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setEditorOpen(false)}>
                Cancel
              </Button>
              <Button onClick={save}>Save</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </AppShell>
    </AdminGate>
  );
}
