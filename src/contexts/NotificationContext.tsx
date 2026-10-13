import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';

export type NotificationType = 'order' | 'promotion' | 'item' | 'system';

export interface Notification {
  id: string;
  type: NotificationType;
  message: string;
  time: string;
  data?: any;
  read?: boolean;
}

interface NotificationContextProps {
  notifications: Notification[];
  addNotification: (notification: Omit<Notification, 'id' | 'time' | 'read'>) => void;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
  removeNotification: (id: string) => void;
}

const NotificationContext = createContext<NotificationContextProps | undefined>(undefined);

const SOUND_MAP: Record<NotificationType, string> = {
  order: '/sounds/order-alert.mp3',
  promotion: '/sounds/promotion-alert.mp3',
  item: '/sounds/item-alert.mp3',
  system: '/sounds/system-alert.mp3',
};

function getNowString() {
  return new Date().toLocaleString();
}

export const NotificationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    // Track dismissed notification IDs
    const [dismissedIds, setDismissedIds] = useState<string[]>(() => {
      try {
        const saved = localStorage.getItem('dismissedNotificationIds');
        return saved ? JSON.parse(saved) : [];
      } catch {
        return [];
      }
    });

    useEffect(() => {
      localStorage.setItem('dismissedNotificationIds', JSON.stringify(dismissedIds));
    }, [dismissedIds]);

  const [permission, setPermission] = useState<NotificationPermission>(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) return 'default';
    return Notification.permission;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    if (Notification.permission === 'default') {
      Notification.requestPermission().then((result) => setPermission(result)).catch(() => {});
    } else {
      setPermission(Notification.permission);
    }
  }, []);

  const [notifications, setNotifications] = useState<Notification[]>(() => {
    try {
      const saved = localStorage.getItem('notifications');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    localStorage.setItem('notifications', JSON.stringify(notifications));
  }, [notifications]);

  const playSound = useCallback((type: NotificationType) => {
    const src = SOUND_MAP[type] || SOUND_MAP.system;
    const fallback = () => {
      try {
        const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
        if (!AudioCtx) return;
        const ctx = new AudioCtx();
        const now = ctx.currentTime;
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = 'sine';
        // different tones per type
        switch (type) {
          case 'order':
            o.frequency.value = 880; g.gain.value = 0.06; break;
          case 'promotion':
            o.frequency.value = 660; g.gain.value = 0.06; break;
          case 'item':
            o.frequency.value = 940; g.gain.value = 0.05; break;
          default:
            o.frequency.value = 440; g.gain.value = 0.04; break;
        }
        o.connect(g); g.connect(ctx.destination);
        o.start(now);
        setTimeout(() => { try { o.stop(); ctx.close(); } catch (e) {} }, 300);
      } catch (e) {
        // ignore
      }
    };

    try {
      const audio = new Audio(src);
      const p = audio.play();
      if (p && typeof p.catch === 'function') p.catch(() => fallback());
    } catch {
      fallback();
    }
  }, []);

  const showBrowserNotification = useCallback(async (notification: Omit<Notification, 'id' | 'time' | 'read'>) => {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;

    const title = notification.type === 'order' ? 'New Order' : 'Mthunzi POS';
    const options: NotificationOptions = {
      body: notification.message,
      icon: '/icons/icon-192.svg',
      tag: notification.data?.orderId || notification.data?.id,
      data: notification.data,
      renotify: true,
    };

    try {
      if ('serviceWorker' in navigator) {
        const registration = await navigator.serviceWorker.ready;
        registration.showNotification(title, options);
        return;
      }
    } catch (e) {
      console.warn('Service worker notification failed', e);
    }

    try {
      new Notification(title, options);
    } catch (e) {
      console.warn('Browser notification failed', e);
    }
  }, []);

  const addNotification = useCallback(async (notification: Omit<Notification, 'id' | 'time' | 'read'>) => {
    // Prevent adding notification if dismissed
    const orderId = notification.data?.orderId || notification.data?.id;
    if (orderId && dismissedIds.includes(orderId)) return;
    const newNotif: Notification = {
      ...notification,
      id: crypto.randomUUID(),
      time: getNowString(),
      read: false,
    };
    setNotifications((prev) => [newNotif, ...prev]);
    playSound(notification.type);
    await showBrowserNotification(notification).catch(() => {});
  }, [playSound, dismissedIds, showBrowserNotification]);

  const markAsRead = useCallback((id: string) => {
    setNotifications((prev) => prev.map(n => n.id === id ? { ...n, read: true } : n));
  }, []);

  const markAllAsRead = useCallback(() => {
    setNotifications((prev) => prev.map(n => ({ ...n, read: true })));
  }, []);

  const removeNotification = useCallback((id: string) => {
    setNotifications((prev) => {
      const updated = prev.filter(n => n.id !== id);
      localStorage.setItem('notifications', JSON.stringify(updated));
      // Also track dismissed orderId
      const removed = prev.find(n => n.id === id);
      const orderId = removed?.data?.orderId || removed?.data?.id;
      if (orderId && !dismissedIds.includes(orderId)) {
        setDismissedIds((prevIds) => [...prevIds, orderId]);
      }
      return updated;
    });
  }, []);

  return (
    <NotificationContext.Provider value={{ notifications, addNotification, markAsRead, markAllAsRead, removeNotification }}>
      {children}
    </NotificationContext.Provider>
  );
};

export function useNotification() {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error('useNotification must be used within NotificationProvider');
  return ctx;
}
