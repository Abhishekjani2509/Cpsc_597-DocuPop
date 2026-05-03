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

type View = "login" | "forgot" | "reset";

export default function LoginForm({ onSuccess, onSwitchToSignUp }: LoginFormProps) {
  const [view, setView] = useState<View>("login");

  // Login state
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // Forgot password state
  const [forgotEmail, setForgotEmail] = useState("");
  const [resetCode, setResetCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  const { signIn, forgotPassword, confirmForgotPassword, mfaState, clearMfaState } = useAuth();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const result = await signIn(email, password);
      if (!result.mfaRequired && !result.mfaSetupRequired && result.user) {
        onSuccess();
      }
    } catch (err: any) {
      setError(err.message || "Login failed");
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      await forgotPassword(forgotEmail);
      setInfo("Reset code sent — check your email.");
      setView("reset");
    } catch (err: any) {
      setError(err.message || "Failed to send reset code");
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    setLoading(true);
    setError("");
    try {
      await confirmForgotPassword(forgotEmail, resetCode, newPassword);
      setInfo("Password reset successfully. You can now sign in.");
      setView("login");
      setForgotEmail("");
      setResetCode("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err: any) {
      setError(err.message || "Reset failed");
    } finally {
      setLoading(false);
    }
  };

  if (mfaState?.required) {
    return <MfaVerifyForm onSuccess={onSuccess} onCancel={() => { clearMfaState(); setPassword(""); }} />;
  }
  if (mfaState?.setupRequired) {
    return <MfaSetupForm onSuccess={onSuccess} onCancel={() => { clearMfaState(); setPassword(""); }} />;
  }

  // ── Forgot password — step 1: enter email ────────────────────────────────
  if (view === "forgot") {
    return (
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Reset Password</CardTitle>
          <CardDescription>Enter your email and we'll send you a reset code.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleForgotPassword} className="space-y-4">
            <Input
              type="email"
              placeholder="Email"
              value={forgotEmail}
              onChange={(e) => setForgotEmail(e.target.value)}
              required
              autoFocus
            />
            {error && <div className="text-sm text-red-600">{error}</div>}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Sending..." : "Send Reset Code"}
            </Button>
          </form>
          <div className="mt-4 text-center">
            <button type="button" onClick={() => { setView("login"); setError(""); }} className="text-sm text-blue-600 hover:underline">
              Back to sign in
            </button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // ── Forgot password — step 2: enter code + new password ──────────────────
  if (view === "reset") {
    return (
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Enter Reset Code</CardTitle>
          <CardDescription>
            {info || `We sent a code to ${forgotEmail}. Enter it below along with your new password.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleResetPassword} className="space-y-4">
            <Input
              type="text"
              placeholder="6-digit reset code"
              value={resetCode}
              onChange={(e) => setResetCode(e.target.value)}
              required
              maxLength={6}
              className="text-center tracking-widest text-lg"
              autoFocus
            />
            <Input
              type="password"
              placeholder="New password (min 8 chars, uppercase, number)"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
            />
            <Input
              type="password"
              placeholder="Confirm new password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
            />
            {error && <div className="text-sm text-red-600">{error}</div>}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Resetting..." : "Reset Password"}
            </Button>
          </form>
          <div className="mt-4 text-center space-y-1">
            <button type="button" onClick={() => { setView("forgot"); setError(""); }} className="text-sm text-blue-600 hover:underline block w-full">
              Resend code
            </button>
            <button type="button" onClick={() => { setView("login"); setError(""); setInfo(""); }} className="text-sm text-gray-500 hover:underline">
              Back to sign in
            </button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // ── Login ─────────────────────────────────────────────────────────────────
  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>Sign In</CardTitle>
        <CardDescription>Enter your email and password to sign in</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleLogin} className="space-y-4">
          <Input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <Input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          {error && <div className="text-sm text-red-600">{error}</div>}
          {info && <div className="text-sm text-green-600">{info}</div>}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Signing in..." : "Sign In"}
          </Button>
        </form>
        <div className="mt-4 flex items-center justify-between">
          <button type="button" onClick={() => { setView("forgot"); setError(""); setInfo(""); setForgotEmail(email); }} className="text-sm text-blue-600 hover:underline">
            Forgot password?
          </button>
          <button type="button" onClick={onSwitchToSignUp} className="text-sm text-blue-600 hover:underline">
            Don&apos;t have an account? Sign up
          </button>
        </div>
      </CardContent>
    </Card>
  );
}
