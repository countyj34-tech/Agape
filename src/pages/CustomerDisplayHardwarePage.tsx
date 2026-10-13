import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Cable,
  Loader2,
  Monitor,
  MonitorSmartphone,
  PlugZap,
  RefreshCw,
  Unplug,
} from 'lucide-react';
import { AppShell } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Slider } from '@/components/ui/slider';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useCustomerDisplayHardware } from '@/hooks/useCustomerDisplayHardware';
import { openCustomerDisplayWindow } from '@/lib/customerDisplay';
import type {
  CustomerDisplayConnectionType,
  CustomerDisplayEncoding,
  CustomerDisplayParity,
} from '@/types/pos';
import { toast } from 'sonner';

const BAUD_RATES = [9600, 19200, 38400, 57600, 115200];

export default function CustomerDisplayHardwarePage() {
  const navigate = useNavigate();
  const {
    state,
    settings,
    ports,
    isSupported,
    refreshPorts,
    saveSettings,
    requestPort,
    connect,
    disconnect,
    reconnect,
    test,
  } = useCustomerDisplayHardware();

  const [draft, setDraft] = useState(settings);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(settings);
  }, [settings]);

  const statusLabel =
    state.kind === 'connected'
      ? `Connected (${state.portLabel})`
      : state.kind === 'connecting'
        ? 'Connecting…'
        : state.kind === 'unsupported'
          ? 'Unsupported (use Chrome/Edge)'
          : state.kind === 'disabled'
            ? 'Disabled'
            : state.kind === 'error'
              ? `Error: ${state.error}`
              : 'Disconnected';

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveSettings({
        ...draft,
        enabled: draft.enabled,
        baudRate: Number(draft.baudRate) || 9600,
        dataBits: 8,
        stopBits: 1,
        encoding: draft.encoding || 'ascii',
        brightness: Math.max(0, Math.min(100, Number(draft.brightness) || 80)),
        lineWidth: Math.max(8, Math.min(40, Number(draft.lineWidth) || 20)),
      });
      toast.success('Customer display settings saved');
      if (draft.enabled && draft.autoReconnect) {
        await reconnect();
      } else if (!draft.enabled) {
        await disconnect();
      }
    } catch (error) {
      toast.error((error as Error).message || 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const handleConnect = async () => {
    setBusy(true);
    try {
      await saveSettings({ ...draft, enabled: true });
      let port = ports.find((p) => p.label === draft.comPort)?.port;
      if (!port) {
        const requested = await requestPort();
        port = requested?.port;
        if (requested) {
          setDraft((d) => ({ ...d, comPort: requested.label, enabled: true }));
        }
      }
      await connect(port);
      await refreshPorts();
      toast.success('Customer display connected');
    } catch (error) {
      toast.error((error as Error).message || 'Connection failed');
    } finally {
      setBusy(false);
    }
  };

  const handleDisconnect = async () => {
    setBusy(true);
    try {
      await disconnect();
      toast.message('Customer display disconnected');
    } finally {
      setBusy(false);
    }
  };

  const handleRefresh = async () => {
    setBusy(true);
    try {
      const next = await refreshPorts();
      toast.success(`Found ${next.length} authorized port${next.length === 1 ? '' : 's'}`);
    } finally {
      setBusy(false);
    }
  };

  const handleTest = async () => {
    setBusy(true);
    try {
      if (state.kind !== 'connected') {
        await handleConnect();
      }
      await test();
      toast.success('Test message sent to customer display');
    } catch (error) {
      toast.error((error as Error).message || 'Test failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell title="Customer Display">
      <div className="mx-auto max-w-2xl space-y-6 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">Customer Display</h1>
            <p className="text-sm text-muted-foreground">
              Settings for the second screen and hardware pole display.
            </p>
          </div>
          <Button variant="outline" onClick={() => navigate('/admin/settings')}>
            Back to Settings
          </Button>
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-primary/10 p-2 text-primary">
                <Monitor className="h-6 w-6" />
              </div>
              <div>
                <CardTitle>Second Screen Display</CardTitle>
                <CardDescription>
                  Opens a full customer-facing price screen on another monitor (Chrome / Edge).
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button
              className="w-full gap-2"
              onClick={() => {
                void (async () => {
                  const result = await openCustomerDisplayWindow();
                  if (!result.window) {
                    toast.error(result.message || 'Could not open customer display');
                    return;
                  }
                  if (result.autoPlaced) {
                    toast.success(result.message || 'Customer display opened on second screen');
                  } else if (result.message) {
                    toast.message(result.message);
                  }
                })();
              }}
            >
              <Monitor className="h-4 w-4" />
              Open Customer Display Window
            </Button>
            <p className="text-xs text-muted-foreground">
              Keep this POS window on the cashier screen. The customer window updates live as you
              ring up items.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-sky-500/10 p-2 text-sky-600">
                <MonitorSmartphone className="h-6 w-6" />
              </div>
              <div>
                <CardTitle>Hardware Customer Display</CardTitle>
                <CardDescription>
                  Pole / VFD display over Serial or USB Virtual COM (Chrome / Edge Web Serial).
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            {!isSupported && (
              <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                Web Serial is not available in this browser. Open Mthunzi POS in desktop Chrome or
                Edge on the POS terminal.
              </div>
            )}

            <div className="flex items-center justify-between rounded-lg border p-4">
              <div>
                <Label htmlFor="cd-enabled">Enable Customer Display</Label>
                <p className="mt-1 text-xs text-muted-foreground">
                  When enabled, cart and payment updates are sent to the rear display.
                </p>
              </div>
              <Checkbox
                id="cd-enabled"
                checked={draft.enabled}
                onCheckedChange={(checked) =>
                  setDraft((d) => ({ ...d, enabled: Boolean(checked) }))
                }
              />
            </div>

            <div className="space-y-3">
              <Label>Connection Type</Label>
              <RadioGroup
                value={draft.connectionType}
                onValueChange={(value) =>
                  setDraft((d) => ({
                    ...d,
                    connectionType: value as CustomerDisplayConnectionType,
                  }))
                }
                className="flex flex-wrap gap-6"
              >
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="serial" id="cd-serial" />
                  <Label htmlFor="cd-serial">Serial (COM)</Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="usb_virtual_com" id="cd-usb" />
                  <Label htmlFor="cd-usb">USB Virtual COM</Label>
                </div>
              </RadioGroup>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <Label>COM Port</Label>
                <div className="flex gap-2">
                  <Select
                    value={draft.comPort || undefined}
                    onValueChange={(value) => setDraft((d) => ({ ...d, comPort: value }))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select an authorized port" />
                    </SelectTrigger>
                    <SelectContent>
                      {ports.length === 0 ? (
                        <SelectItem value="__none" disabled>
                          No ports yet — click Connect / Refresh
                        </SelectItem>
                      ) : (
                        ports.map((p) => (
                          <SelectItem key={p.id} value={p.label}>
                            {p.label}
                          </SelectItem>
                        ))
                      )}
                      {['COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6'].map((com) => (
                        <SelectItem key={com} value={com}>
                          {com}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={handleRefresh}
                    disabled={busy}
                    title="Refresh Ports"
                  >
                    <RefreshCw className="h-4 w-4" />
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Browser security requires choosing the USB/COM device once. After that, ports are
                  remembered on this POS terminal.
                </p>
              </div>

              <div className="space-y-2">
                <Label>Baud Rate</Label>
                <Select
                  value={String(draft.baudRate)}
                  onValueChange={(value) =>
                    setDraft((d) => ({ ...d, baudRate: Number(value) || 9600 }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {BAUD_RATES.map((rate) => (
                      <SelectItem key={rate} value={String(rate)}>
                        {rate}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Data Bits</Label>
                <Input value="8" disabled />
              </div>

              <div className="space-y-2">
                <Label>Parity</Label>
                <Select
                  value={draft.parity}
                  onValueChange={(value) =>
                    setDraft((d) => ({ ...d, parity: value as CustomerDisplayParity }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    <SelectItem value="even">Even</SelectItem>
                    <SelectItem value="odd">Odd</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Stop Bits</Label>
                <Input value="1" disabled />
              </div>

              <div className="space-y-2">
                <Label>Encoding</Label>
                <Select
                  value={draft.encoding}
                  onValueChange={(value) =>
                    setDraft((d) => ({ ...d, encoding: value as CustomerDisplayEncoding }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ascii">ASCII</SelectItem>
                    <SelectItem value="utf8">UTF-8</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Line Width</Label>
                <Select
                  value={String(draft.lineWidth || 20)}
                  onValueChange={(value) =>
                    setDraft((d) => ({ ...d, lineWidth: Number(value) || 20 }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="16">16</SelectItem>
                    <SelectItem value="20">20</SelectItem>
                    <SelectItem value="40">40</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex items-center justify-between rounded-lg border p-4">
              <div>
                <Label htmlFor="cd-auto">Reconnect Automatically</Label>
                <p className="mt-1 text-xs text-muted-foreground">
                  Retries every 5 seconds if the cable is unplugged.
                </p>
              </div>
              <Checkbox
                id="cd-auto"
                checked={draft.autoReconnect}
                onCheckedChange={(checked) =>
                  setDraft((d) => ({ ...d, autoReconnect: Boolean(checked) }))
                }
              />
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>Display Brightness</Label>
                <span className="text-sm text-muted-foreground">{draft.brightness}%</span>
              </div>
              <Slider
                value={[draft.brightness]}
                min={0}
                max={100}
                step={5}
                onValueChange={(value) =>
                  setDraft((d) => ({ ...d, brightness: value[0] ?? 80 }))
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="cd-test-msg">Test Message</Label>
              <Input
                id="cd-test-msg"
                value={draft.testMessage}
                onChange={(e) => setDraft((d) => ({ ...d, testMessage: e.target.value }))}
                placeholder="Customer Display Working Successfully"
              />
            </div>

            <div className="rounded-md border bg-muted/40 p-3 text-sm">
              <div className="flex items-center gap-2">
                <Cable className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium">Status</span>
              </div>
              <p className="mt-1 text-muted-foreground">{statusLabel}</p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button onClick={handleConnect} disabled={busy || !isSupported}>
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PlugZap className="mr-2 h-4 w-4" />}
                Connect
              </Button>
              <Button variant="outline" onClick={handleDisconnect} disabled={busy}>
                <Unplug className="mr-2 h-4 w-4" />
                Disconnect
              </Button>
              <Button variant="outline" onClick={handleRefresh} disabled={busy || !isSupported}>
                <RefreshCw className="mr-2 h-4 w-4" />
                Refresh Ports
              </Button>
              <Button variant="secondary" onClick={handleTest} disabled={busy || !isSupported}>
                Test Display
              </Button>
            </div>

            <div className="flex justify-end gap-2 border-t pt-4">
              <Button variant="outline" onClick={() => navigate('/admin/settings')}>
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={saving}>
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save Settings
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
