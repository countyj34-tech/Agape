import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Lock, Delete, ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PinEntryProps {
  onSubmit: (pin: string) => void;
  onCancel?: () => void;
  onForgotPin?: () => void;
  title?: string;
  subtitle?: string;
  error?: string;
  isSetup?: boolean;
  minLength?: number;
  maxLength?: number;
}

export function PinEntry({
  onSubmit,
  onCancel,
  onForgotPin,
  title = 'Enter PIN',
  subtitle,
  error,
  isSetup = false,
  minLength = 4,
  maxLength = 6,
}: PinEntryProps) {
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [isConfirming, setIsConfirming] = useState(false);
  const [localError, setLocalError] = useState('');

  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const currentPin = isConfirming ? confirmPin : pin;
  const setCurrentPin = isConfirming ? setConfirmPin : setPin;

  const handleNumberClick = (num: string) => {
    if (currentPin.length < maxLength) {
      setCurrentPin(currentPin + num);
      setLocalError('');
    }
  };

  const handleDelete = () => {
    setCurrentPin(currentPin.slice(0, -1));
    setLocalError('');
  };

  const handleClear = () => {
    setCurrentPin('');
    setLocalError('');
  };

  const handleSubmit = () => {
    if (currentPin.length < minLength) {
      setLocalError(`PIN must be at least ${minLength} digits`);
      return;
    }

    if (isSetup) {
      if (!isConfirming) {
        setIsConfirming(true);
        return;
      }

      if (pin !== confirmPin) {
        setLocalError('PINs do not match');
        setConfirmPin('');
        return;
      }
    }

    onSubmit(pin);
  };

  const displayError = localError || error;

  const numpadButtons = [
    ['1', '2', '3'],
    ['4', '5', '6'],
    ['7', '8', '9'],
    ['clear', '0', 'delete'],
  ];

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm space-y-8">
        {/* Header */}
        <div className="text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
            <img
              src="/icons/icon-192.svg"
              alt="Mthunzi-Tech-Labs logo"
              className="h-10 w-10 rounded-full object-contain"
            />
          </div>
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
            <Lock className="h-8 w-8 text-primary" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">
            {isConfirming ? 'Confirm PIN' : title}
          </h1>
          {subtitle && !isConfirming && (
            <p className="mt-2 text-muted-foreground">{subtitle}</p>
          )}
          {isConfirming && (
            <p className="mt-2 text-muted-foreground">Enter your PIN again to confirm</p>
          )}
        </div>

        {/* PIN Display */}
        <div className="flex justify-center gap-3">
          {Array.from({ length: maxLength }).map((_, i) => (
            <div
              key={i}
              className={cn(
                'h-4 w-4 rounded-full border-2 transition-all duration-200',
                i < currentPin.length
                  ? 'scale-110 border-primary bg-primary'
                  : 'border-muted-foreground/30 bg-transparent'
              )}
            />
          ))}
        </div>

        {/* Error Message */}
        {displayError && (
          <p className="text-center text-sm font-medium text-destructive animate-fade-in">
            {displayError}
          </p>
        )}

        {/* Hidden input for keyboard support */}
        <Input
          ref={inputRef}
          type="password"
          inputMode="numeric"
          pattern="[0-9]*"
          value={currentPin}
          onChange={(e) => {
            const value = e.target.value.replace(/\D/g, '').slice(0, maxLength);
            setCurrentPin(value);
            setLocalError('');
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              handleSubmit();
            }
          }}
          className="sr-only"
          autoComplete="off"
        />

        {/* Numpad */}
        <div className="grid grid-cols-3 gap-3">
          {numpadButtons.flat().map((btn) => {
            if (btn === 'clear') {
              return (
                <Button
                  key={btn}
                  variant="ghost"
                  size="lg"
                  onClick={handleClear}
                  className="h-16 text-lg font-medium text-muted-foreground hover:bg-muted"
                >
                  Clear
                </Button>
              );
            }
            if (btn === 'delete') {
              return (
                <Button
                  key={btn}
                  variant="ghost"
                  size="lg"
                  onClick={handleDelete}
                  className="h-16 text-muted-foreground hover:bg-muted"
                >
                  <Delete className="h-6 w-6" />
                </Button>
              );
            }
            return (
              <Button
                key={btn}
                variant="outline"
                size="lg"
                onClick={() => handleNumberClick(btn)}
                className="h-16 text-2xl font-semibold hover:bg-primary/10 active:bg-primary/20"
              >
                {btn}
              </Button>
            );
          })}
        </div>

        {/* Submit Button */}
        <Button
          onClick={handleSubmit}
          disabled={currentPin.length < minLength}
          className="h-14 w-full text-lg font-semibold"
          size="lg"
        >
          {isSetup ? (isConfirming ? 'Set PIN' : 'Continue') : 'Unlock'}
        </Button>

        {/* Cancel / Back Button */}
        {(onCancel || isConfirming) && (
          <Button
            variant="ghost"
            onClick={() => {
              if (isConfirming) {
                setIsConfirming(false);
                setConfirmPin('');
                setLocalError('');
              } else if (onCancel) {
                onCancel();
              }
            }}
            className="w-full text-muted-foreground"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            {isConfirming ? 'Back' : 'Cancel'}
          </Button>
        )}

        {/* Forgot PIN Button */}
        {!isSetup && !isConfirming && onForgotPin && (
          <Button
            variant="ghost"
            onClick={onForgotPin}
            className="w-full text-sm text-muted-foreground hover:text-primary"
          >
            Forgot PIN?
          </Button>
        )}
      </div>

      {/* Branding */}
      <div className="mt-8 text-center text-xs text-muted-foreground">
        Powered by <span className="font-medium">Mthunzi-Tech-Labs</span>
      </div>
    </div>
  );
}
