import { useCallback } from 'react';
import type { Product, Sale } from '@/types/pos';
import { useCart } from '@/contexts/CartContext';
import { completeSaleAtomic } from '@/lib/db';

export function usePOS() {
  const { state, addItem, removeItem, updateQuantity, clearCart, setDiscount } = useCart();

  const addToCart = useCallback(
    (product: Product) => {
      addItem(product, 1);
    },
    [addItem]
  );

  const processCheckout = useCallback(
    async (args: { paymentMethod: Sale['paymentMethod'] }): Promise<Sale> => {
      const sale = await completeSaleAtomic({
        items: state.items.map((i) => ({
          productId: i.product.id,
          quantity: i.quantity,
          unitPrice: i.product.sellingPrice,
        })),
        discount: state.discount,
        paymentMethod: args.paymentMethod,
      });

      clearCart();
      return sale;
    },
    [clearCart, state.discount, state.items]
  );

  return {
    cart: state,
    addToCart,
    removeFromCart: removeItem,
    updateCartQuantity: updateQuantity,
    clearCart,
    setDiscount,
    processCheckout,
  };
}
