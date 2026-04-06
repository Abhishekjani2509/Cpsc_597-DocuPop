"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/components/AuthProvider";

interface MfaVerifyFormProps {
  onSuccess: () => void;
  onCancel: () => void;
}

export default function MfaVerifyForm({ onSuccess, onCancel }: MfaVerifyFormProps) {
  const [mfaCode, setMfaCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const { verifyMfa, mfaState } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      await verifyMfa(mfaCode);
      onSuccess();
    } catch (err: any) {
      setError(err.message || "Invalid code. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleCodeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Only allow digits and limit to 6 characters
    const value = e.target.value.replace(/\D/g, "").slice(0, 6);
    setMfaCode(value);
  };

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>Two-Factor Authentication</CardTitle>
        <CardDescription>
          Enter the 6-digit code from your authenticator app
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
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
              autoFocus
              required
            />
          </div>
          {error && (
            <div className="text-sm text-red-600">{error}</div>
          )}
          <div className="text-sm text-gray-500">
            Signing in as {mfaState?.email}
          </div>
          <Button
            type="submit"
            className="w-full"
            disabled={loading || mfaCode.length !== 6}
          >
            {loading ? "Verifying..." : "Verify"}
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