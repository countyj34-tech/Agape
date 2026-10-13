import { memo } from 'react';
import { Plus, Minus, AlertTriangle } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ProductImageBackground } from '@/components/ProductImage';
import { cn } from '@/lib/utils';
import { getStockStatus, type Product } from '@/types/pos';

type PosProductCardProps = {
  product: Product;
  quantityInCart: number;
  viewMode: 'grid' | 'list';
  priceLabel: string;
  needsUnitChoice: boolean;
  showAddFx: boolean;
  onAdd: (product: Product) => void;
  onIncrement: (product: Product) => void;
  onDecrement: (lineId: string, nextQty: number) => void;
  defaultLineId: string | null;
  defaultLineQty: number;
};

function QtyStepper({
  quantity,
  canIncrement,
  onDecrement,
  onIncrement,
}: {
  quantity: number;
  canIncrement: boolean;
  onDecrement: () => void;
  onIncrement: () => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-2 py-1.5">
      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onDecrement} type="button">
        <Minus className="h-4 w-4" />
      </Button>
      <span className="w-8 text-center text-sm font-semibold">{quantity}</span>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        onClick={onIncrement}
        disabled={!canIncrement}
        type="button"
      >
        <Plus className="h-4 w-4" />
      </Button>
    </div>
  );
}

function PosProductCardInner({
  product,
  quantityInCart,
  viewMode,
  priceLabel,
  needsUnitChoice,
  showAddFx,
  onAdd,
  onIncrement,
  onDecrement,
  defaultLineId,
  defaultLineQty,
}: PosProductCardProps) {
  const stockStatus = getStockStatus(product);
  const isOutOfStock = stockStatus === 'out-of-stock';
  const canIncrement = quantityInCart < product.stock;
  const useStepper = quantityInCart > 0 && !needsUnitChoice && !!defaultLineId;

  if (viewMode === 'list') {
    return (
      <Card
        className={cn(
          'relative w-full min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm',
          isOutOfStock && 'opacity-70'
        )}
      >
        <div className="flex items-center gap-3 p-3">
          <button
            type="button"
            className={cn(
              'relative h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-slate-100',
              !isOutOfStock && 'cursor-pointer'
            )}
            onClick={() => {
              if (!isOutOfStock) onAdd(product);
            }}
            disabled={isOutOfStock}
            aria-label={`Add ${product.name}`}
          >
            {product.imageUrl ? (
              <ProductImageBackground
                productId={product.id}
                localImageUrl={product.imageUrl}
                className="absolute inset-0 h-full w-full"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-lg font-bold text-primary">
                {product.name.charAt(0).toUpperCase()}
              </div>
            )}
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold">{product.name}</p>
            <p className="text-sm text-muted-foreground">{priceLabel}</p>
          </div>
          {quantityInCart === 0 ? (
            <Button size="sm" onClick={() => onAdd(product)} disabled={isOutOfStock}>
              {isOutOfStock ? 'Out' : <Plus className="h-4 w-4" />}
            </Button>
          ) : useStepper ? (
            <div className="flex items-center gap-1 rounded-full border px-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => onDecrement(defaultLineId!, defaultLineQty - 1)}
              >
                <Minus className="h-4 w-4" />
              </Button>
              <span className="w-6 text-center text-sm font-semibold">{quantityInCart}</span>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => onIncrement(product)}
                disabled={!canIncrement}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <Button size="sm" onClick={() => onAdd(product)} disabled={!canIncrement}>
              <Plus className="mr-1 h-4 w-4" />
              {quantityInCart}
            </Button>
          )}
        </div>
      </Card>
    );
  }

  const footer =
    isOutOfStock && quantityInCart === 0 ? (
      <p className="truncate text-center text-sm font-medium text-destructive">Out of stock</p>
    ) : useStepper ? (
      <QtyStepper
        quantity={quantityInCart}
        canIncrement={canIncrement}
        onDecrement={() => onDecrement(defaultLineId!, defaultLineQty - 1)}
        onIncrement={() => onIncrement(product)}
      />
    ) : quantityInCart > 0 ? (
      <button
        type="button"
        className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-left"
        onClick={() => onAdd(product)}
        disabled={!canIncrement}
      >
        <span className="text-sm font-semibold">In cart: {quantityInCart}</span>
        <Plus className="h-4 w-4 text-primary" />
      </button>
    ) : null;

  return (
    <Card
      className={cn(
        'relative flex h-full w-full min-w-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm',
        isOutOfStock && 'opacity-70'
      )}
    >
      <button
        type="button"
        className={cn(
          'relative aspect-square w-full overflow-hidden bg-slate-100 text-left',
          !isOutOfStock && 'cursor-pointer active:scale-[0.98] transition-transform',
          isOutOfStock && 'cursor-not-allowed'
        )}
        onClick={() => {
          if (!isOutOfStock) onAdd(product);
        }}
        disabled={isOutOfStock}
        aria-label={`Add ${product.name}`}
      >
        {product.imageUrl ? (
          <ProductImageBackground
            productId={product.id}
            localImageUrl={product.imageUrl}
            className="absolute inset-0 h-full w-full"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-slate-100 text-4xl font-bold text-primary/40">
            {product.name.charAt(0).toUpperCase()}
          </div>
        )}

        <div className="absolute left-2 top-2 z-10 flex items-center gap-2">
          {stockStatus === 'low-stock' && (
            <Badge variant="outline" className="gap-1 border-warning bg-warning/10 text-[11px] text-warning">
              <AlertTriangle className="h-3 w-3" />
              Low
            </Badge>
          )}
          {isOutOfStock && <Badge variant="destructive">Out</Badge>}
        </div>

        {showAddFx && (
          <div className="pointer-events-none absolute right-3 top-3 z-10 rounded-full bg-primary px-2 py-1 text-xs font-bold text-primary-foreground">
            +1
          </div>
        )}
      </button>

      <div className="flex flex-1 flex-col gap-1.5 p-2.5 pt-2">
        <div className="min-h-[2.75rem] text-center">
          <p className="line-clamp-2 text-sm font-semibold leading-snug text-slate-900">{product.name}</p>
          <p className="mt-0.5 text-sm font-bold text-primary">{priceLabel}</p>
        </div>
        {footer}
      </div>
    </Card>
  );
}

export const PosProductCard = memo(PosProductCardInner);
