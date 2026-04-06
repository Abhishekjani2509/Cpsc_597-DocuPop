"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/components/AuthProvider";

interface MfaSetupFormProps {
  onSuccess: () => void;
  onCancel: () => void;
}

export default function MfaSetupForm({ onSuccess, onCancel }: MfaSetupFormProps) {
  const [mfaCode, setMfaCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingSecret, setLoadingSecret] = useState(true);
  const [error, setError] = useState("");
  const [secretCode, setSecretCode] = useState("");
  const { getMfaSetupSecret, completeMfaSetup, mfaState } = useAuth();

  useEffect(() => {
    const loadSecret = async () => {
      try {
        const result = await getMfaSetupSecret();
        setSecretCode(result.secretCode);
      } catch (err: any) {
        setError(err.message || "Failed to load MFA setup");
      } finally {
        setLoadingSecret(false);
      }
    };

    loadSecret();
  }, [getMfaSetupSecret]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      await completeMfaSetup(mfaCode);
      onSuccess();
    } catch (err: any) {
      setError(err.message || "Invalid code. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleCodeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace(/\D/g, "").slice(0, 6);
    setMfaCode(value);
  };

  const formatSecretCode = (code: string) => {
    // Format as groups of 4 for easier reading
    return code.match(/.{1,4}/g)?.join(" ") || code;
  };

  if (loadingSecret) {
    return (
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Setting Up Two-Factor Authentication</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>Set Up Two-Factor Authentication</CardTitle>
        <CardDescription>
          Scan the QR code or enter the secret key in your authenticator app
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* QR Code placeholder - in production you'd use a QR library */}
          <div className="bg-gray-100 p-4 rounded-lg">
            <p className="text-sm text-gray-600 mb-2">
              Add this account to your authenticator app (Google Authenticator, Authy, etc.)
            </p>
            <div className="bg-white p-4 rounded border">
              <p className="text-xs text-gray-500 mb-1">Secret Key:</p>
              <p className="font-mono text-sm break-all select-all">
                {formatSecretCode(secretCode)}
              </p>
            </div>
            <p className="text-xs text-gray-500 mt-2">
              Account: DocuPop ({mfaState?.email})
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Enter the 6-digit code from your app
            </label>
            <Input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              placeholder="000000"
              value={mfaCode}
              onChange={handleCodeChange}
              className="text-center text-2xl tracking-widest"
              maxLength={6}
              autoComplete="one-time-code"
              required
            />
          </div>

          {error && (
            <div className="text-sm text-red-600">{error}</div>
          )}

          <Button
            type="submit"
            className="w-full"
            disabled={loading || mfaCode.length !== 6}
          >
            {loading ? "Verifying..." : "Complete Setup"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="w-full"
            onClick={onCancel}
          >
            Cancel
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
