import { AppShell } from '@/components/layout/AppShell';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Barcode, Database, LockKeyhole, Receipt, Store, Wallet } from 'lucide-react';
import { Link } from 'react-router-dom';

const MANUAL_SECTIONS: Array<{ id: string; title: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'sell', title: 'How to Sell (Cashier Guide)', icon: Receipt },
  { id: 'multi-stores', title: 'Managing Multi-Stores', icon: Store },
  { id: 'shortages', title: 'Shortages (End-of-Day)', icon: Wallet },
  { id: 'data-safety', title: 'Data Safety & Backups', icon: Database },
  { id: 'hardware', title: 'Barcode & Printing', icon: Barcode },
  { id: 'activation', title: 'Activation & Install', icon: LockKeyhole },
];

function scrollToSection(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

export default function UserManualPage() {
  return (
    <AppShell title="User Manual" hideFooter>
      <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-4 sm:px-6 sm:py-6">
        <Card className="overflow-hidden">
          <div className="bg-gradient-to-r from-primary/15 via-primary/5 to-transparent">
            <CardHeader className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">Offline-first</Badge>
                <Badge variant="secondary">Barcode Ready</Badge>
                <Badge variant="secondary">Bluetooth Printing</Badge>
              </div>
              <div className="space-y-1">
                <CardTitle className="text-2xl tracking-tight sm:text-3xl">Mthunzi POS — User Manual</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Short, practical guides for cashiers and admins. Built for fast training.
                </p>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row">
                <Button asChild variant="default" className="sm:w-auto">
                  <Link to="/">Open POS</Link>
                </Button>
                <Button asChild variant="outline" className="sm:w-auto">
                  <Link to="/reports">Open Reports (EOD)</Link>
                </Button>
                <Button asChild variant="outline" className="sm:w-auto">
                  <Link to="/admin">Admin Dashboard</Link>
                </Button>
              </div>
            </CardHeader>
          </div>
        </Card>

        {/* Mobile TOC (collapsible) */}
        <Card className="md:hidden">
          <CardHeader>
            <CardTitle className="text-base">On this page</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <Accordion type="single" collapsible className="w-full">
              <AccordionItem value="toc" className="border-b-0">
                <AccordionTrigger className="py-2 text-sm">Open table of contents</AccordionTrigger>
                <AccordionContent className="pt-2">
                  <div className="flex flex-col gap-1">
                    {MANUAL_SECTIONS.map((s) => (
                      <Button
                        key={s.id}
                        type="button"
                        variant="ghost"
                        className="justify-start gap-2"
                        onClick={() => scrollToSection(s.id)}
                      >
                        <s.icon className="h-4 w-4" />
                        <span className="truncate">{s.title}</span>
                      </Button>
                    ))}
                  </div>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </CardContent>
        </Card>

        <div className="grid gap-6 md:grid-cols-[280px_1fr]">
          <Card className="hidden h-fit md:sticky md:top-20 md:block">
            <CardHeader>
              <CardTitle className="text-base">On this page</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <ScrollArea className="max-h-[60vh] md:max-h-[calc(100vh-9rem)]">
                <div className="flex flex-col gap-1 p-2">
                  {MANUAL_SECTIONS.map((s) => (
                    <Button
                      key={s.id}
                      type="button"
                      variant="ghost"
                      className="justify-start gap-2"
                      onClick={() => scrollToSection(s.id)}
                    >
                      <s.icon className="h-4 w-4" />
                      <span className="truncate">{s.title}</span>
                    </Button>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>

          <div className="space-y-4">
            <Accordion type="single" collapsible className="w-full space-y-3">
              <AccordionItem id="sell" value="how-to-sell" className="rounded-lg border border-b-0 bg-card px-4">
                <AccordionTrigger className="no-underline hover:no-underline">
                  <div className="flex items-center gap-2">
                    <Receipt className="h-4 w-4 text-muted-foreground" />
                    <span>How to Sell (Cashier Guide)</span>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="text-sm leading-relaxed">
                  <ol className="ml-4 list-decimal space-y-2">
                    <li>
                      <span className="font-semibold">Scan or select product:</span> scan the barcode or tap a product
                      from the list to add it to the cart.
                    </li>
                    <li>
                      <span className="font-semibold">Confirm price & quantity:</span> review items, adjust quantity or
                      discounts, then choose payment method (cash, card, mobile or credit).
                    </li>
                    <li>
                      <span className="font-semibold">Finish & receipt:</span> complete the sale, then print/share the
                      receipt from the receipt screen.
                    </li>
                  </ol>
                </AccordionContent>
              </AccordionItem>

              <AccordionItem
                id="multi-stores"
                value="multi-stores"
                className="rounded-lg border border-b-0 bg-card px-4"
              >
                <AccordionTrigger className="no-underline hover:no-underline">
                  <div className="flex items-center gap-2">
                    <Store className="h-4 w-4 text-muted-foreground" />
                    <span>Managing Multi-Stores (Kitchen vs Bar)</span>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="text-sm leading-relaxed">
                  <ul className="ml-4 list-disc space-y-2">
                    <li>
                      Open the <span className="font-semibold">Admin Dashboard</span> and use the store selector to
                      choose a store such as <span className="font-semibold">Kitchen</span> or
                      <span className="font-semibold"> Bar</span>.
                    </li>
                    <li>
                      When a store is selected, POS/Inventory/Sales/Reports screens show data for that store. New
                      products and sales are saved under that store.
                    </li>
                    <li>
                      For owner-wide totals, switch to <span className="font-semibold">All Stores (Global View)</span>.
                    </li>
                  </ul>
                </AccordionContent>
              </AccordionItem>

              <AccordionItem
                id="shortages"
                value="shortages"
                className="rounded-lg border border-b-0 bg-card px-4"
              >
                <AccordionTrigger className="no-underline hover:no-underline">
                  <div className="flex items-center gap-2">
                    <Wallet className="h-4 w-4 text-muted-foreground" />
                    <span>Handling Shortages (End-of-Day)</span>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="text-sm leading-relaxed">
                  <p className="mb-3">
                    Use the <span className="font-semibold">End-of-Day / Closing Report</span> to compare expected cash
                    vs physical cash.
                  </p>
                  <ul className="ml-4 list-disc space-y-2">
                    <li>
                      Enter the <span className="font-semibold">physical cash counted</span> during shift closing.
                    </li>
                    <li>
                      The app calculates the <span className="font-semibold">difference</span> and marks it as
                      <span className="font-semibold"> Overage</span> or <span className="font-semibold">Shortage</span>.
                    </li>
                    <li>
                      Add a short note (refund, wrong float, etc). This appears in the Closing Report for audits.
                    </li>
                  </ul>
                </AccordionContent>
              </AccordionItem>

              <AccordionItem
                id="data-safety"
                value="data-safety"
                className="rounded-lg border border-b-0 bg-card px-4"
              >
                <AccordionTrigger className="no-underline hover:no-underline">
                  <div className="flex items-center gap-2">
                    <Database className="h-4 w-4 text-muted-foreground" />
                    <span>Data Safety & Backups</span>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="text-sm leading-relaxed">
                  <ul className="ml-4 list-disc space-y-2">
                    <li>
                      All data is stored <span className="font-semibold">locally on this device</span> (IndexedDB).
                    </li>
                    <li>
                      In <span className="font-semibold">Admin &gt; Settings</span>, enable
                      <span className="font-semibold"> persistent storage</span> (Data Guard) to reduce data eviction.
                    </li>
                    <li>
                      Before changing devices, use <span className="font-semibold">Download Backup (JSON)</span> and keep
                      it safe.
                    </li>
                    <li>
                      On a new device, use <span className="font-semibold">Import Backup</span> to restore history.
                    </li>
                  </ul>
                </AccordionContent>
              </AccordionItem>

              <AccordionItem
                id="hardware"
                value="hardware"
                className="rounded-lg border border-b-0 bg-card px-4"
              >
                <AccordionTrigger className="no-underline hover:no-underline">
                  <div className="flex items-center gap-2">
                    <Barcode className="h-4 w-4 text-muted-foreground" />
                    <span>Barcode & Printing (Offline)</span>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="text-sm leading-relaxed">
                  <ul className="ml-4 list-disc space-y-2">
                    <li>
                      <span className="font-semibold">Barcode scanners</span> usually work as a keyboard. Click the POS
                      search bar and scan — the product will be found automatically.
                    </li>
                    <li>
                      <span className="font-semibold">Bluetooth printing</span> is supported for ESC/POS thermal
                      printers. Connect once and it will auto-reconnect when possible.
                    </li>
                    <li>
                      If printing fails, confirm the printer is powered on and Bluetooth is enabled on the device.
                    </li>
                  </ul>
                </AccordionContent>
              </AccordionItem>

              <AccordionItem
                id="activation"
                value="activation"
                className="rounded-lg border border-b-0 bg-card px-4"
              >
                <AccordionTrigger className="no-underline hover:no-underline">
                  <div className="flex items-center gap-2">
                    <LockKeyhole className="h-4 w-4 text-muted-foreground" />
                    <span>Activation & Install (PWA)</span>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="text-sm leading-relaxed">
                  <ul className="ml-4 list-disc space-y-2">
                    <li>
                      When shared, the suite opens locked and shows your <span className="font-semibold">Device ID</span>.
                    </li>
                    <li>
                      Tap <span className="font-semibold">Request Activation Key via WhatsApp</span>, then paste the key
                      you receive and tap <span className="font-semibold">Activate</span>.
                    </li>
                    <li>
                      For best offline performance, use the on-screen <span className="font-semibold">Install</span>
                      prompt to add the app to your home screen.
                    </li>
                  </ul>
                </AccordionContent>
              </AccordionItem>
            </Accordion>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Need help?</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                If something looks wrong (missing products, printer issues, or activation help), contact support from the
                Activation screen WhatsApp button.
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
