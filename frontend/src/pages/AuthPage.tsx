import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';
import { 
  Lock, 
  ArrowLeft, 
  ShieldCheck, 
  Eye, 
  EyeOff, 
  Phone, 
  Mail, 
  CheckCircle2, 
  AlertCircle, 
  KeyRound, 
  Send 
} from 'lucide-react';

interface AuthPageProps {
  initialTab?: 'login' | 'signup';
  onBackToHome?: () => void;
  onSuccess?: () => void;
}

export const AuthPage: React.FC<AuthPageProps> = ({ 
  onBackToHome,
  onSuccess
}) => {
  const { login, loginWithOtp } = useAuth();

  // Sign In State (Dual Mode: Admin Email + Password vs User Phone + SMS OTP)
  const [loginIdentifier, setLoginIdentifier] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [usePasswordMode, setUsePasswordMode] = useState(false);

  // SMS OTP State
  const [otpCode, setOtpCode] = useState('');
  const [isOtpSent, setIsOtpSent] = useState(false);
  const [isSendingOtp, setIsSendingOtp] = useState(false);
  const [otpCountdown, setOtpCountdown] = useState(0);
  const [sentTargetPhone, setSentTargetPhone] = useState('');

  // Dynamically determine whether to present Password flow (e.g. Email entered or explicitly selected)
  const isEmailInput = loginIdentifier.includes('@');
  const isPasswordFlow = isEmailInput || usePasswordMode;

  // General State
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Resend OTP countdown timer
  useEffect(() => {
    if (otpCountdown <= 0) return;
    const timer = setInterval(() => {
      setOtpCountdown(prev => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [otpCountdown]);

  // Send OTP handler via SMS
  const handleSendOtp = async () => {
    setError(null);
    setSuccessMessage(null);
    const target = loginIdentifier.trim();
    if (!target) {
      setError('Please enter your mobile number or registered email to receive OTP.');
      return;
    }

    setIsSendingOtp(true);
    try {
      const res = await api.sendOtp(target);
      setIsOtpSent(true);
      setSentTargetPhone((res as any).maskedPhone || (res as any).phone || target);
      setSuccessMessage((res as any).message || `OTP sent successfully to ${(res as any).maskedPhone || target} via SMS.`);
      setOtpCountdown(30);
    } catch (err: any) {
      setError(err.message || 'Failed to send SMS OTP. Please check the mobile number or email.');
    } finally {
      setIsSendingOtp(false);
    }
  };

  // Submit Sign In with OTP (Phone/Email + SMS OTP)
  const handleOtpLoginSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setSuccessMessage(null);

    const identifier = loginIdentifier.trim();
    const code = otpCode.trim();

    if (!identifier) {
      setError('Please enter your mobile number or email.');
      return;
    }
    if (!code || code.length !== 6) {
      setError('Please enter the valid 6-digit OTP code received on your mobile.');
      return;
    }

    setLoading(true);
    try {
      await loginWithOtp(identifier, code);
      setSuccessMessage('Verified successfully! Signing you in...');
      if (onSuccess) onSuccess();
    } catch (err: any) {
      setError(err.message || 'Incorrect or expired OTP. Please enter the valid code.');
    } finally {
      setLoading(false);
    }
  };

  // Submit Sign In with Password (Admin Email / Password)
  const handlePasswordLoginSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setSuccessMessage(null);

    const identifier = loginIdentifier.trim();
    if (!identifier) {
      setError('Please enter your email or mobile number.');
      return;
    }
    if (!loginPassword) {
      setError('Please enter your password.');
      return;
    }

    setLoading(true);
    try {
      await login(identifier, loginPassword);
      setSuccessMessage('Signed in successfully!');
      if (onSuccess) onSuccess();
    } catch (err: any) {
      setError(err.message || 'Failed to sign in. Please verify your credentials.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] flex flex-col justify-center items-center px-4 py-8 sm:py-12">
      {/* Top Navigation & Brand Header */}
      <div className="w-full max-w-md flex items-center justify-between mb-5">
        {onBackToHome ? (
          <button
            type="button"
            onClick={onBackToHome}
            className="flex items-center gap-2 text-xs font-bold text-slate-600 hover:text-slate-900 transition p-2 rounded-xl hover:bg-white border border-transparent hover:border-slate-200 cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4 text-[#E60012]" />
            <span>Back to Home</span>
          </button>
        ) : <div />}

        <div className="flex items-center gap-1.5 text-xs text-slate-500 font-medium">
          <ShieldCheck className="w-4 h-4 text-emerald-600" />
          <span>256-Bit SSL Secured</span>
        </div>
      </div>

      {/* Main Auth Card (White & Red Enterprise Design) */}
      <div className="w-full max-w-md bg-white rounded-3xl border border-slate-200/90 shadow-xl overflow-hidden">
        {/* Brand Banner */}
        <div className="p-6 pb-4 bg-white border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img 
              src="/gpstrackx-icon.png" 
              alt="GpsTrackX Icon" 
              className="w-10 h-10 object-contain drop-shadow-xs" 
            />
            <div>
              <div className="flex items-center gap-1">
                <span className="font-black text-lg tracking-tight text-slate-900">GpsTrack</span>
                <span className="font-black text-lg tracking-tight text-[#E60012]">X</span>
              </div>
              <p className="text-[11px] text-slate-500 font-medium">Enterprise Telematics & FASTag Fleet Platform</p>
            </div>
          </div>
        </div>

        <div className="p-6 space-y-4">
          {/* Header titles */}
          <div>
            <h2 className="text-xl font-black text-slate-900 tracking-tight">
              Sign In to GpsTrackX
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {isPasswordFlow ? 'Enter your registered email and password to sign in' : 'Enter your registered mobile number to receive a 6-digit SMS OTP'}
            </p>
          </div>

          {/* Feedback Alerts */}
          {error && (
            <div className="p-3 rounded-2xl bg-red-50 border border-red-200 text-xs font-semibold text-red-700 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-[#E60012] mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {successMessage && (
            <div className="p-3 rounded-2xl bg-emerald-50 border border-emerald-200 text-xs font-semibold text-emerald-700 flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600 mt-0.5" />
              <span>{successMessage}</span>
            </div>
          )}

          {/* SIGN IN FORM (UNIFIED DUAL-MODE: ADMIN EMAIL+PASSWORD vs USER PHONE+OTP) */}
          {isPasswordFlow ? (
              // Mode A: Password Flow (Admin Email/Mobile + Password)
              <form onSubmit={handlePasswordLoginSubmit} className="space-y-4">
                <div>
                  <label htmlFor="login-password-identifier" className="block text-xs font-bold text-slate-700 mb-1.5">
                    Email or Mobile Number *
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                      {isEmailInput ? <Mail className="w-4 h-4" /> : <Phone className="w-4 h-4" />}
                    </div>
                    <input
                      id="login-password-identifier"
                      type="text"
                      required
                      value={loginIdentifier}
                      onChange={(e) => setLoginIdentifier(e.target.value)}
                      placeholder="e.g. admin@gpstrackx.com or 9876543210"
                      className="w-full pl-10 pr-3.5 py-2.5 rounded-xl border border-slate-200 bg-white font-medium text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-[#E60012] focus:ring-2 focus:ring-[#E60012]/15 transition"
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="login-password-input" className="block text-xs font-bold text-slate-700 mb-1.5">
                    Password *
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                      <Lock className="w-4 h-4" />
                    </div>
                    <input
                      id="login-password-input"
                      type={showLoginPassword ? 'text' : 'password'}
                      required
                      value={loginPassword}
                      onChange={(e) => setLoginPassword(e.target.value)}
                      placeholder="Enter account password"
                      className="w-full pl-10 pr-10 py-2.5 rounded-xl border border-slate-200 bg-white font-medium text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-[#E60012] focus:ring-2 focus:ring-[#E60012]/15 transition"
                    />
                    <button
                      type="button"
                      onClick={() => setShowLoginPassword(!showLoginPassword)}
                      className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-400 hover:text-slate-600 cursor-pointer"
                    >
                      {showLoginPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading || !loginIdentifier.trim() || !loginPassword}
                  className="w-full py-3 px-4 bg-[#E60012] hover:bg-[#CC0010] text-white font-extrabold text-xs rounded-xl shadow-xs transition flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 mt-2"
                >
                  <KeyRound className="w-4 h-4 text-white" />
                  <span>{loading ? 'Signing in...' : 'Sign In with Password'}</span>
                </button>

                <div className="text-center pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setUsePasswordMode(false);
                      setError(null);
                    }}
                    className="text-xs text-slate-500 hover:text-slate-800 font-semibold cursor-pointer transition underline decoration-dotted"
                  >
                    Sign in with SMS OTP instead
                  </button>
                </div>
              </form>
            ) : (
              // Mode B: SMS OTP Flow (User Mobile Number + SMS OTP)
              <form onSubmit={handleOtpLoginSubmit} className="space-y-4">
                <div>
                  <label htmlFor="login-otp-identifier" className="block text-xs font-bold text-slate-700 mb-1.5">
                    Mobile Number *
                  </label>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                        <Phone className="w-4 h-4" />
                      </div>
                      <input
                        id="login-otp-identifier"
                        type="text"
                        required
                        value={loginIdentifier}
                        onChange={(e) => {
                          setLoginIdentifier(e.target.value);
                          setIsOtpSent(false);
                        }}
                        placeholder="e.g. 9876543210"
                        className="w-full pl-10 pr-3.5 py-2.5 rounded-xl border border-slate-200 bg-white font-medium text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-[#E60012] focus:ring-2 focus:ring-[#E60012]/15 transition"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={handleSendOtp}
                      disabled={isSendingOtp || otpCountdown > 0 || !loginIdentifier.trim()}
                      className="px-3.5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs rounded-xl shadow-2xs transition flex items-center gap-1.5 shrink-0 disabled:opacity-50 cursor-pointer"
                    >
                      {isSendingOtp ? (
                        <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <Send className="w-3.5 h-3.5 text-emerald-400" />
                      )}
                      <span>{otpCountdown > 0 ? `${otpCountdown}s` : isOtpSent ? 'Resend' : 'Send OTP'}</span>
                    </button>
                  </div>
                  {sentTargetPhone && isOtpSent && (
                    <p className="text-[11px] text-emerald-700 font-semibold mt-1.5 flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                      <span>OTP sent to {sentTargetPhone} via SMS</span>
                    </p>
                  )}
                </div>

                <div>
                  <label htmlFor="login-otp-code" className="block text-xs font-bold text-slate-700 mb-1.5">
                    Enter 6-Digit SMS OTP *
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                      <KeyRound className="w-4 h-4" />
                    </div>
                    <input
                      id="login-otp-code"
                      type="text"
                      maxLength={6}
                      required
                      value={otpCode}
                      onChange={(e) => setOtpCode(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
                      placeholder="Enter 6-digit OTP code from SMS"
                      className="w-full pl-10 pr-3.5 py-2.5 rounded-xl border border-slate-200 bg-white font-mono font-bold text-center tracking-widest text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-[#E60012] focus:ring-2 focus:ring-[#E60012]/15 transition"
                    />
                  </div>
                  <p className="text-[10px] text-slate-400 mt-1">
                    Check your mobile SMS inbox for the 6-digit verification code.
                  </p>
                </div>

                <button
                  type="submit"
                  disabled={loading || !otpCode.trim() || otpCode.trim().length !== 6}
                  className="w-full py-3 px-4 bg-[#E60012] hover:bg-[#CC0010] text-white font-extrabold text-xs rounded-xl shadow-xs transition flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 mt-2"
                >
                  <CheckCircle2 className="w-4 h-4 text-emerald-300" />
                  <span>{loading ? 'Verifying OTP...' : 'Verify OTP & Sign In'}</span>
                </button>

                <div className="text-center pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setUsePasswordMode(true);
                      setError(null);
                    }}
                    className="text-xs text-slate-500 hover:text-slate-800 font-semibold cursor-pointer transition underline decoration-dotted"
                  >
                    Sign in with Password instead
                  </button>
                </div>
              </form>
            )
          }

          {/* Bottom Security Note */}
          <div className="pt-3 border-t border-slate-100 text-center">
            <p className="text-[11px] text-slate-400">
              By accessing GpsTrackX, you agree to Fleet Telematics Terms and Data Compliance Standards.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
