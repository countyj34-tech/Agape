import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import App from "./App.tsx";
import "./index.css";
import { NotificationProvider } from './contexts/NotificationContext';
import { SupabaseAuthProvider } from '@/contexts/SupabaseAuthContext';
import { isSupabaseConfigured } from '@/lib/supabase';

import { registerSW } from 'virtual:pwa-register';
import { ThemeProvider } from "@/components/theme-provider";
import { BootSplash } from "@/components/BootSplash";
import { dexieDb, initializeSettings } from "@/lib/db";
import ErrorBoundary from "@/components/ErrorBoundary";
import { removeDemoStoreAndDataLocalOnly } from '@/lib/demoStoreInitializer';

if (import.meta.env.PROD) {
	registerSW({
		immediate: true,
	});
} else {
	console.info('Service worker registration skipped in development mode');
	// Clear any leftover production SW that can freeze navigation in local testing.
	if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
		navigator.serviceWorker.getRegistrations().then((regs) => {
			regs.forEach((r) => r.unregister());
		}).catch(() => undefined);
	}
}

function Root() {
	const [ready, setReady] = useState(false);

	useEffect(() => {
		let cancelled = false;
		(async () => {
			try {
				// Initialize database in background without blocking
				dexieDb.open().catch(e => console.error('DB open failed:', e));
				initializeSettings().catch(e => console.error('Settings init failed:', e));
				void removeDemoStoreAndDataLocalOnly();

				// Startup debug: show whether Supabase env/config is present
				try {
					const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
					console.info('Mthunzi debug: Supabase config', {
						configured: isSupabaseConfigured(),
						supabaseHost: supabaseUrl ? (() => { try { return new URL(supabaseUrl).host } catch { return supabaseUrl } })() : '(none)',
						hasAnonKey: Boolean(import.meta.env.VITE_SUPABASE_ANON_KEY),
						hasServiceKey: Boolean(import.meta.env.VITE_SUPABASE_SERVICE_ROLE_KEY),
					});
					// expose for quick inspection in DevTools
					;(window as any).__MTZ_SUPABASE_DEBUG = {
						configured: isSupabaseConfigured(),
						supabaseUrl,
						hasAnonKey: Boolean(import.meta.env.VITE_SUPABASE_ANON_KEY),
						hasServiceKey: Boolean(import.meta.env.VITE_SUPABASE_SERVICE_ROLE_KEY),
					};
				} catch (e) {
					console.warn('Supabase debug logging failed', e);
				}
				// Set ready immediately without waiting for database
				setReady(true);
			} catch (e) {
				console.error('Startup failed:', e);
				if (!cancelled) setReady(true);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, []);

	return (
		<ErrorBoundary>
			<ThemeProvider attribute="class" defaultTheme="light" enableSystem={false} themes={["light", "dark", "night"]}>
				{!ready ? (
					<BootSplash />
				) : (
					<SupabaseAuthProvider>
						<NotificationProvider>
							<App />
						</NotificationProvider>
					</SupabaseAuthProvider>
				)}
			</ThemeProvider>
		</ErrorBoundary>
	);
}

// Get the root element
const container = document.getElementById("root");
if (!container) {
  throw new Error('Root element not found');
}

// Check if a root already exists
let root = (container as any)._reactRoot;
if (!root) {
  root = createRoot(container);
  (container as any)._reactRoot = root;
}

root.render(<Root />);
