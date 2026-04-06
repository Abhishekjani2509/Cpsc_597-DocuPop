"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/components/AuthProvider";
import MfaVerifyForm from "./MfaVerifyForm";
import MfaSetupForm from "./MfaSetupForm";

interface LoginFormProps {
  onSuccess: () => void;
  onSwitchToSignUp: () => void;
}

export default function LoginForm({ onSuccess, onSwitchToSignUp }: LoginFormProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const { signIn, mfaState, clearMfaState } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const result = await signIn(email, password);

      // If MFA is not required, login is complete
      if (!result.mfaRequired && !result.mfaSetupRequired && result.user) {
        onSuccess();
      }
      // If MFA is required, the mfaState will be set by AuthProvider
      // and we'll render the appropriate MFA form
    } catch (err: any) {
      setError(err.message || "Login failed");
    } finally {
      setLoading(false);
    }
  };

  const handleMfaCancel = () => {
    clearMfaState();
    setPassword("");
  };

  // Show MFA verification form if MFA is required
  if (mfaState?.required) {
    return (
      <MfaVerifyForm
        onSuccess={onSuccess}
        onCancel={handleMfaCancel}
      />
    );
  }

  // Show MFA setup form if first-time MFA setup is required
  if (mfaState?.setupRequired) {
    return (
      <MfaSetupForm
        onSuccess={onSuccess}
        onCancel={handleMfaCancel}
      />
    );
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>Sign In</CardTitle>
        <CardDescription>
          Enter your email and password to sign in
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div>
            <Input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          {error && (
            <div className="text-sm text-red-600">{error}</div>
          )}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Signing in..." : "Sign In"}
          </Button>
        </form>
        <div className="mt-4 text-center">
          <button
            type="button"
            onClick={onSwitchToSignUp}
            className="text-sm text-blue-600 hover:underline"
          >
            Don&apos;t have an account? Sign up
          </button>
        </div>
      </CardContent>
    </Card>
  );
}