import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from 'react';
import type { CartItem, Product } from '@/types/pos';

interface CartState {
  items: CartItem[];
  subtotal: number;
  discount: number;
  total: number;
}

type CartAction =
  | { type: 'ADD_ITEM'; product: Product; quantity?: number; unitPrice?: number }
  | { type: 'REMOVE_ITEM'; lineId: string }
  | { type: 'UPDATE_QUANTITY'; lineId: string; quantity: number }
  | { type: 'SET_DISCOUNT'; discount: number }
  | { type: 'CLEAR_CART' }
  | { type: 'HYDRATE'; state: CartState };

interface CartContextType {
  state: CartState;
  addItem: (product: Product, quantity?: number, unitPrice?: number) => void;
  removeItem: (lineId: string) => void;
  updateQuantity: (lineId: string, quantity: number) => void;
  setDiscount: (discount: number) => void;
  clearCart: () => void;
  itemCount: number;
  persistCartNow: () => void;
  hydrateFromStorage: () => boolean;
}

const CartContext = createContext<CartContextType | undefined>(undefined);
const CART_STORAGE_KEY = 'mthunzi:pos-cart-v1';

const emptyState: CartState = { items: [], subtotal: 0, discount: 0, total: 0 };

function calculateTotals(items: CartItem[], discount: number): { subtotal: number; total: number } {
  const subtotal = items.reduce(
    (sum, item) => sum + (item.unitPrice ?? item.product.sellingPrice) * item.quantity,
    0
  );
  const total = Math.max(0, subtotal - discount);
  return { subtotal, total };
}

function reviveCartState(raw: unknown): CartState | null {
  if (!raw || typeof raw !== 'object') return null;
  const parsed = raw as Partial<CartState>;
  if (!Array.isArray(parsed.items)) return null;

  const items = parsed.items.filter(
    (item): item is CartItem =>
      !!item &&
      typeof item === 'object' &&
      typeof (item as CartItem).lineId === 'string' &&
      !!(item as CartItem).product &&
      typeof (item as CartItem).quantity === 'number'
  );

  const discount = Number(parsed.discount) || 0;
  const { subtotal, total } = calculateTotals(items, discount);
  return { items, discount, subtotal, total };
}

function loadCartState(): CartState {
  try {
    const raw = sessionStorage.getItem(CART_STORAGE_KEY);
    if (!raw) return emptyState;
    return reviveCartState(JSON.parse(raw)) ?? emptyState;
  } catch {
    return emptyState;
  }
}

function cartReducer(state: CartState, action: CartAction): CartState {
  switch (action.type) {
    case 'HYDRATE':
      return action.state;

    case 'ADD_ITEM': {
      const effectiveUnitPrice = action.unitPrice ?? action.product.sellingPrice;
      const lineId = `${action.product.id}::${Number(effectiveUnitPrice).toFixed(2)}`;

      const existingIndex = state.items.findIndex((item) => item.lineId === lineId);

      let newItems: CartItem[];
      if (existingIndex >= 0) {
        newItems = state.items.map((item, index) =>
          index === existingIndex
            ? { ...item, quantity: item.quantity + (action.quantity || 1) }
            : item
        );
      } else {
        newItems = [
          ...state.items,
          {
            lineId,
            product: action.product,
            quantity: action.quantity || 1,
            unitPrice: action.unitPrice,
          },
        ];
      }

      const { subtotal, total } = calculateTotals(newItems, state.discount);
      return { ...state, items: newItems, subtotal, total };
    }

    case 'REMOVE_ITEM': {
      const newItems = state.items.filter((item) => item.lineId !== action.lineId);
      const { subtotal, total } = calculateTotals(newItems, state.discount);
      return { ...state, items: newItems, subtotal, total };
    }

    case 'UPDATE_QUANTITY': {
      if (action.quantity <= 0) {
        const newItems = state.items.filter((item) => item.lineId !== action.lineId);
        const { subtotal, total } = calculateTotals(newItems, state.discount);
        return { ...state, items: newItems, subtotal, total };
      }

      const newItems = state.items.map((item) =>
        item.lineId === action.lineId ? { ...item, quantity: action.quantity } : item
      );
      const { subtotal, total } = calculateTotals(newItems, state.discount);
      return { ...state, items: newItems, subtotal, total };
    }

    case 'SET_DISCOUNT': {
      const { subtotal, total } = calculateTotals(state.items, action.discount);
      return { ...state, discount: action.discount, subtotal, total };
    }

    case 'CLEAR_CART':
      return { ...emptyState };

    default:
      return state;
  }
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(cartReducer, undefined, loadCartState);
  const stateRef = useRef(state);
  stateRef.current = state;

  const persistCartNow = useCallback((next: CartState = stateRef.current) => {
    try {
      if (next.items.length === 0 && next.discount === 0) {
        sessionStorage.removeItem(CART_STORAGE_KEY);
      } else {
        sessionStorage.setItem(CART_STORAGE_KEY, JSON.stringify(next));
      }
    } catch {
      /* ignore quota / private mode */
    }
  }, []);

  // Debounce persistence for rapid Add taps; Checkout flushes immediately.
  useEffect(() => {
    const timer = window.setTimeout(() => persistCartNow(state), 250);
    return () => window.clearTimeout(timer);
  }, [state, persistCartNow]);

  const addItem = useCallback((product: Product, quantity?: number, unitPrice?: number) => {
    dispatch({ type: 'ADD_ITEM', product, quantity, unitPrice });
  }, []);

  const removeItem = useCallback((lineId: string) => {
    dispatch({ type: 'REMOVE_ITEM', lineId });
  }, []);

  const updateQuantity = useCallback((lineId: string, quantity: number) => {
    dispatch({ type: 'UPDATE_QUANTITY', lineId, quantity });
  }, []);

  const setDiscount = useCallback((discount: number) => {
    dispatch({ type: 'SET_DISCOUNT', discount });
  }, []);

  const clearCart = useCallback(() => {
    dispatch({ type: 'CLEAR_CART' });
    try {
      sessionStorage.removeItem(CART_STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  const hydrateFromStorage = useCallback(() => {
    const loaded = loadCartState();
    if (loaded.items.length === 0) return false;
    dispatch({ type: 'HYDRATE', state: loaded });
    return true;
  }, []);

  const itemCount = useMemo(
    () => state.items.reduce((sum, item) => sum + item.quantity, 0),
    [state.items]
  );

  const value = useMemo(
    () => ({
      state,
      addItem,
      removeItem,
      updateQuantity,
      setDiscount,
      clearCart,
      itemCount,
      persistCartNow,
      hydrateFromStorage,
    }),
    [
      state,
      addItem,
      removeItem,
      updateQuantity,
      setDiscount,
      clearCart,
      itemCount,
      persistCartNow,
      hydrateFromStorage,
    ]
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const context = useContext(CartContext);
  if (context === undefined) {
    throw new Error('useCart must be used within a CartProvider');
  }
  return context;
}
