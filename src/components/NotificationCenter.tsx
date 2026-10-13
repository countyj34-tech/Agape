import React from "react";
import { useNotification } from "@/contexts/NotificationContext";
import { toast } from "sonner";

export const NotificationCenter: React.FC = () => {
  const { notifications, markAsRead } = useNotification();
  const [open, setOpen] = React.useState(true);
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

  // Show toast for unread notifications (order type only)
  React.useEffect(() => {
    notifications.forEach((notif) => {
      if (!notif.read && notif.type === "order") {
        toast(
          notif.message,
          {
            action: {
              label: "View Receipt",
              onClick: () => {
                playNotificationSound();
                // Navigate to sales page first
                window.location.href = "/sales";
                // After navigation, proceed to receipt if orderId is present
                setTimeout(() => {
                  if (notif.data?.orderId) {
                    window.location.href = `/receipt/${notif.data.orderId}`;
                  }
                  markAsRead(notif.id);
                }, 500);
              },
            },
            duration: 8000,
            onAutoClose: () => markAsRead(notif.id),
          }
        );
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notifications]);

  // Render notification list
  if (!open) return null;
  return (
    <div style={{ position: 'fixed', top: 60, right: 20, zIndex: 1000, background: '#fff', boxShadow: '0 2px 8px rgba(0,0,0,0.15)', borderRadius: 8, width: 350, maxHeight: 500, overflowY: 'auto', padding: 16 }}>
      <div style={{ fontWeight: 'bold', fontSize: 18, marginBottom: 8 }}>Notifications</div>
      <button style={{ color: '#007bff', background: 'none', border: 'none', cursor: 'pointer', marginBottom: 8 }} onClick={() => notifications.forEach(n => markAsRead(n.id))}>Mark all as read</button>
      <div>
        {notifications.length === 0 && <div style={{ color: '#888' }}>No notifications</div>}
        {notifications.map((notif) => (
          <div
            key={notif.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              background: notif.read ? '#f7f7f7' : '#e6f7ff',
              borderRadius: 6,
              marginBottom: 8,
              padding: 10,
              cursor: 'pointer',
              boxShadow: notif.read ? 'none' : '0 1px 4px rgba(0,0,0,0.08)'
            }}
            onClick={() => {
              playNotificationSound();
              markAsRead(notif.id);
              setOpen(false);
              // Navigate to sales page first
              window.location.href = "/sales";
              setTimeout(() => {
                if (notif.data?.orderId) {
                  window.location.href = `/receipt/${notif.data.orderId}`;
                }
              }, 500);
            }}
          >
            <span style={{ marginRight: 12 }}>
              <span role="img" aria-label="box">📦</span>
            </span>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 500 }}>{notif.message}</div>
              <div style={{ fontSize: 12, color: '#888' }}>{notif.time}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
