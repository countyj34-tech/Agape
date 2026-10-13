import { ReactNode } from 'react';
import { Header } from './Header';
import { Footer } from './Footer';
import { MobileNav } from './MobileNav';
import { cn } from '@/lib/utils';
import { EodClosingPrompt } from '@/components/pos/EodClosingPrompt';
import { HostingPausedBanner } from '@/components/pos/HostingPausedBanner';
import { InstallPrompt } from '@/components/InstallPrompt';
import { useSideMenu } from '@/components/layout/SideMenu';
import { unlockPageInteraction } from '@/lib/unlockPageInteraction';

interface AppShellProps {
  children: ReactNode;
  showSearch?: boolean;
  onSearchChange?: (query: string) => void;
  onBarcodeClick?: () => void;
  onCartClick?: () => void;
  searchValue?: string;
  title?: string;
  hideNav?: boolean;
  hideFooter?: boolean;
}

export function AppShell({
  children,
  showSearch = false,
  onSearchChange,
  onBarcodeClick,
  onCartClick,
  searchValue,
  title,
  hideNav = false,
  hideFooter = false,
}: AppShellProps) {
  const { openMenu } = useSideMenu();

  return (
    <div className="flex min-h-screen w-full flex-col overflow-x-hidden bg-background">
      <Header
        onMenuClick={() => {
          unlockPageInteraction();
          openMenu();
        }}
        onSearchChange={onSearchChange}
        onBarcodeClick={onBarcodeClick}
        onCartClick={onCartClick}
        searchValue={searchValue}
        showSearch={showSearch}
        title={title}
      />

      <InstallPrompt />
      <HostingPausedBanner />
      <EodClosingPrompt />

      <main className={cn('w-full min-w-0 flex-1', !hideNav && 'pb-20 md:pb-0')}>{children}</main>

      {!hideNav && <MobileNav />}
      {!hideFooter && <Footer />}
    </div>
  );
}
