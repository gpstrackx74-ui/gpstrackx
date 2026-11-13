import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';
import { 
  Lock, 
  ArrowLeft, 
  ShieldCheck, 
  Eye, 
  EyeOff, 
  Building2, 
  User, 
  Phone,
  Mail,
  CheckCircle2,
  AlertCircle,
  KeyRound,
  Send,
  RefreshCw
} from 'lucide-react';

interface AuthPageProps {
  initialTab?: 'login' | 'signup';
  onBackToHome?: () => void;
  onSuccess?: () => void;
}

export const AuthPage: React.FC<AuthPageProps> = ({ 
  initialTab = 'login',
  onBackToHome,
  onSuccess
}) => {
  const { login, loginWithOtp, register } = useAuth();
  const [activeTab, setActiveTab] = useState<'login' | 'signup'>(initialTab);

  // Sign In State
  const [loginMethod, setLoginMethod] = useState<'password' | 'otp'>('password');
  const [loginIdentifier, setLoginIdentifier] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [showLoginPassword, setShowLoginPassword] = useState(false);

  // SMS OTP Login State
  const [otpCode, setOtpCode] = useState('');
  const [isOtpSent, setIsOtpSent] = useState(false);
  const [isSendingOtp, setIsSendingOtp] = useState(false);
  const [otpCountdown, setOtpCountdown] = useState(0);
  const [sentTargetPhone, setSentTargetPhone] = useState('');
  const [debugOtpCode, setDebugOtpCode] = useState<string | null>(null);

  // Sign Up State
  const [name, setName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [signupPassword, setSignupPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showSignupPassword, setShowSignupPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // General State
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const cleanPhone = (val: string) => val.replace(/[^0-9]/g, '').slice(0, 10);

  // Resend OTP countdown timer
  useEffect(() => {
    if (otpCountdown <= 0) return;
    const timer = setInterval(() => {
      setOtpCountdown(prev => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [otpCountdown]);

  // Progressive retrieval of saved credentials from Google Password Manager
  useEffect(() => {
    if (activeTab !== 'login') return;
    if (typeof window !== 'undefined' && (window as any).PasswordCredential && navigator.credentials) {
      try {
        (navigator as any).credentials.get({
          password: true,
          mediation: 'optional'
        }).then((cred: any) => {
          if (cred && cred.id) {
            setLoginIdentifier(prev => prev || cred.id);
            if (cred.password) setLoginPassword(prev => prev || cred.password);
          }
        }).catch(() => {});
      } catch (_) {}
    }
  }, [activeTab]);

  // Send OTP handler
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
      setSuccessMessage((res as any).message || `OTP sent successfully to ${(res as any).maskedPhone || target} via Fast2SMS.`);
      if ((res as any).debugOtp) {
        setDebugOtpCode((res as any).debugOtp);
      }
      setOtpCountdown(30);
    } catch (err: any) {
      setError(err.message || 'Failed to send SMS OTP. Please check the mobile number or email.');
    } finally {
      setIsSendingOtp(false);
    }
  };

  // Submit Sign In with Password (Phone/Email + Password)
  const handleLoginSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setSuccessMessage(null);

    const form = e.currentTarget;
    const formUsername = (form.elements.namedItem('username') as HTMLInputElement)?.value;
    const formPassword = (form.elements.namedItem('password') as HTMLInputElement)?.value;

    const identifier = (formUsername !== undefined && formUsername.trim() !== '' ? formUsername : loginIdentifier).trim();
    const password = (formPassword !== undefined && formPassword !== '' ? formPassword : loginPassword);

    if (!identifier) {
      setError('Please enter your mobile number or email');
      return;
    }
    if (!password) {
      setError('Please enter your password');
      return;
    }

    setLoading(true);
    try {
      await login(identifier, password, async (user) => {
        if (typeof window !== 'undefined' && (window as any).PasswordCredential && navigator.credentials) {
          try {
            let cred: any = null;
            try {
              cred = new (window as any).PasswordCredential(form);
            } catch (_) {
              cred = new (window as any).PasswordCredential({
                id: identifier,
                password: password,
                name: user?.name || identifier
              });
            }
            if (cred) {
              await (navigator as any).credentials.store(cred);
            }
          } catch (credErr) {
            console.debug('Credential store event:', credErr);
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 80));
      });

      if (onSuccess) onSuccess();
    } catch (err: any) {
      setError(err.message || 'Login failed. Please verify your mobile number/email and password.');
    } finally {
      setLoading(false);
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

  // Submit Sign Up (Direct Password Creation, No OTP)
  const handleSignupSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setSuccessMessage(null);

    const form = e.currentTarget;
    const formName = (form.elements.namedItem('name') as HTMLInputElement)?.value || name;
    const formPhone = (form.elements.namedItem('username') as HTMLInputElement)?.value || phone;
    const formCompany = (form.elements.namedItem('organization') as HTMLInputElement)?.value || companyName;
    const formEmail = (form.elements.namedItem('email') as HTMLInputElement)?.value || email;
    const formPassword = (form.elements.namedItem('password') as HTMLInputElement)?.value || signupPassword;
    const formConfirmPassword = (form.elements.namedItem('confirm_password') as HTMLInputElement)?.value || confirmPassword;

    const cleanName = formName.trim();
    const cleanedPhone = cleanPhone(formPhone);

    if (!cleanName) {
      setError('Username / Full name is required.');
      return;
    }

    if (cleanedPhone.length !== 10) {
      setError('Please enter a valid 10-digit Indian mobile number.');
      return;
    }

    if (formPassword.length < 4) {
      setError('Password must be at least 4 characters long.');
      return;
    }

    if (formPassword !== formConfirmPassword) {
      setError('Passwords do not match. Please verify both password fields.');
      return;
    }

    setLoading(true);
    try {
      await register({
        name: cleanName,
        company_name: formCompany.trim() || undefined,
        phone: cleanedPhone,
        email: formEmail.trim() || undefined,
        password: formPassword,
        confirmPassword: formConfirmPassword,
        role: 'user'
      }, async (user) => {
        // Offer credential to Google Password Manager while form element is active in DOM
        if (typeof window !== 'undefined' && (window as any).PasswordCredential && navigator.credentials) {
          try {
            let cred: any = null;
            try {
              cred = new (window as any).PasswordCredential(form);
            } catch (_) {
              cred = new (window as any).PasswordCredential({
                id: cleanedPhone || formEmail.trim() || cleanName,
                password: formPassword,
                name: user?.name || cleanName
              });
            }
            if (cred) {
              await (navigator as any).credentials.store(cred);
            }
          } catch (credErr) {
            console.debug('Credential store event:', credErr);
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 80));
      });

      setSuccessMessage('Account created successfully! Signing you in...');
      if (onSuccess) onSuccess();
    } catch (err: any) {
      setError(err.message || 'Registration failed. Mobile number may already be registered.');
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

        {/* Auth Mode Toggle Tabs (Sign In / Sign Up) */}
        <div className="p-2 m-4 mb-2 bg-slate-100/80 rounded-2xl flex items-center gap-1 border border-slate-200/60">
          <button
            type="button"
            onClick={() => { setActiveTab('login'); setError(null); setSuccessMessage(null); }}
            className={`flex-1 py-2 text-xs font-extrabold rounded-xl transition cursor-pointer ${
              activeTab === 'login'
                ? 'bg-white text-slate-900 shadow-sm border border-slate-200/80'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            Sign In
          </button>
          <button
            type="button"
            onClick={() => { setActiveTab('signup'); setError(null); setSuccessMessage(null); }}
            className={`flex-1 py-2 text-xs font-extrabold rounded-xl transition cursor-pointer ${
              activeTab === 'signup'
                ? 'bg-white text-slate-900 shadow-sm border border-slate-200/80'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            Create Account
          </button>
        </div>

        <div className="p-6 pt-3 space-y-4">
          {/* Header titles */}
          <div>
            <h2 className="text-xl font-black text-slate-900 tracking-tight">
              {activeTab === 'login' ? 'Welcome Back' : 'Create Fleet Account'}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {activeTab === 'login' 
                ? 'Sign in with your mobile number or email and password'
                : 'Register your mobile number to access live fleet telemetry & assigned routes'}
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

          {/* SIGN IN FORM (PASSWORD OR SMS OTP) */}
          {activeTab === 'login' && (
            <div className="space-y-4">
              {/* Method Switch: Password vs SMS OTP */}
              <div className="flex items-center gap-1.5 p-1 bg-slate-100/90 rounded-xl border border-slate-200/80">
                <button
                  type="button"
                  onClick={() => { setLoginMethod('password'); setError(null); setSuccessMessage(null); }}
                  className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer ${
                    loginMethod === 'password'
                      ? 'bg-white text-slate-900 shadow-2xs'
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  <Lock className="w-3.5 h-3.5 text-slate-600" />
                  <span>Password Login</span>
                </button>
                <button
                  type="button"
                  onClick={() => { setLoginMethod('otp'); setError(null); setSuccessMessage(null); }}
                  className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer ${
                    loginMethod === 'otp'
                      ? 'bg-white text-[#E60012] shadow-2xs'
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  <Phone className="w-3.5 h-3.5 text-[#E60012]" />
                  <span>SMS OTP Login</span>
                </button>
              </div>

              {loginMethod === 'password' ? (
                <form onSubmit={handleLoginSubmit} method="POST" action="/api/auth/login" autoComplete="on" className="space-y-4">
                  <div>
                    <label htmlFor="login-username" className="block text-xs font-bold text-slate-700 mb-1.5">
                      Mobile Number or Email *
                    </label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                        <Phone className="w-4 h-4" />
                      </div>
                      <input
                        id="login-username"
                        name="username"
                        autoComplete="username"
                        type="text"
                        required
                        value={loginIdentifier}
                        onChange={(e) => setLoginIdentifier(e.target.value)}
                        placeholder="e.g. 9876543210 or name@company.com"
                        className="w-full pl-10 pr-3.5 py-2.5 rounded-xl border border-slate-200 bg-white font-medium text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-[#E60012] focus:ring-2 focus:ring-[#E60012]/15 transition"
                      />
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label htmlFor="login-password" className="block text-xs font-bold text-slate-700">Password *</label>
                      <button
                        type="button"
                        onClick={() => { setLoginMethod('otp'); setError(null); setSuccessMessage(null); }}
                        className="text-[10px] font-bold text-[#E60012] hover:underline cursor-pointer"
                      >
                        Sign in with OTP instead?
                      </button>
                    </div>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                        <Lock className="w-4 h-4" />
                      </div>
                      <input
                        id="login-password"
                        name="password"
                        autoComplete="current-password"
                        type={showLoginPassword ? 'text' : 'password'}
                        required
                        value={loginPassword}
                        onChange={(e) => setLoginPassword(e.target.value)}
                        placeholder="••••••••"
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
                    disabled={loading}
                    className="w-full py-3 px-4 bg-[#E60012] hover:bg-[#CC0010] text-white font-extrabold text-xs rounded-xl shadow-xs transition flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 mt-2"
                  >
                    <span>{loading ? 'Authenticating...' : 'Sign In to GpsTrackX'}</span>
                  </button>
                </form>
              ) : (
                <form onSubmit={handleOtpLoginSubmit} className="space-y-4">
                  <div>
                    <label htmlFor="login-otp-identifier" className="block text-xs font-bold text-slate-700 mb-1.5">
                      Mobile Number or Registered Email *
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
                            setDebugOtpCode(null);
                          }}
                          placeholder="e.g. 9876543210 or admin@fleet.com"
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
                        <span>OTP sent to {sentTargetPhone} via Fast2SMS</span>
                      </p>
                    )}
                    {debugOtpCode && (
                      <div className="mt-1.5 p-2 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 flex items-center justify-between font-mono">
                        <span>SMS Verification Code: <strong>{debugOtpCode}</strong></span>
                        <button
                          type="button"
                          onClick={() => setOtpCode(debugOtpCode)}
                          className="text-[10px] font-bold text-emerald-700 underline cursor-pointer"
                        >
                          Auto-fill
                        </button>
                      </div>
                    )}
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label htmlFor="login-otp-code" className="block text-xs font-bold text-slate-700">Enter 6-Digit SMS OTP *</label>
                      <button
                        type="button"
                        onClick={() => { setLoginMethod('password'); setError(null); setSuccessMessage(null); }}
                        className="text-[10px] font-bold text-[#E60012] hover:underline cursor-pointer"
                      >
                        Use password instead?
                      </button>
                    </div>
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
                        placeholder="Enter 6-digit OTP code"
                        className="w-full pl-10 pr-3.5 py-2.5 rounded-xl border border-slate-200 bg-white font-mono font-bold text-center tracking-widest text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-[#E60012] focus:ring-2 focus:ring-[#E60012]/15 transition"
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={loading || !otpCode.trim() || otpCode.trim().length !== 6}
                    className="w-full py-3 px-4 bg-[#E60012] hover:bg-[#CC0010] text-white font-extrabold text-xs rounded-xl shadow-xs transition flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 mt-2"
                  >
                    <CheckCircle2 className="w-4 h-4 text-emerald-300" />
                    <span>{loading ? 'Verifying OTP...' : 'Verify OTP & Sign In'}</span>
                  </button>
                </form>
              )}
            </div>
          )}

          {/* SIGN UP FORM (FULL NAME, COMPANY NAME OPTIONAL, MOBILE, EMAIL, PASSWORD, CONFIRM PASSWORD - NO OTP) */}
          {activeTab === 'signup' && (
            <form onSubmit={handleSignupSubmit} method="POST" action="/api/auth/register" autoComplete="on" className="space-y-3.5">
              <div>
                <label htmlFor="signup-name" className="block text-xs font-bold text-slate-700 mb-1">Full Name / Username *</label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                    <User className="w-4 h-4" />
                  </div>
                  <input
                    id="signup-name"
                    name="name"
                    autoComplete="name"
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Ramesh Patel"
                    className="w-full pl-10 pr-3.5 py-2.5 rounded-xl border border-slate-200 bg-white font-medium text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-[#E60012] focus:ring-2 focus:ring-[#E60012]/15 transition"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="signup-company" className="block text-xs font-bold text-slate-700 mb-1">Company / Fleet Name (Optional)</label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                    <Building2 className="w-4 h-4" />
                  </div>
                  <input
                    id="signup-company"
                    name="organization"
                    autoComplete="organization"
                    type="text"
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    placeholder="e.g. Om Logistics Transport"
                    className="w-full pl-10 pr-3.5 py-2.5 rounded-xl border border-slate-200 bg-white font-medium text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-[#E60012] focus:ring-2 focus:ring-[#E60012]/15 transition"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="signup-username" className="block text-xs font-bold text-slate-700 mb-1">Mobile Number (10 Digits) *</label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400 font-mono text-xs font-bold">
                    +91
                  </div>
                  <input
                    id="signup-username"
                    name="username"
                    autoComplete="username"
                    type="tel"
                    required
                    maxLength={10}
                    value={phone}
                    onChange={(e) => setPhone(cleanPhone(e.target.value))}
                    placeholder="9876543210"
                    className="w-full pl-12 pr-3.5 py-2.5 rounded-xl border border-slate-200 bg-white font-mono font-bold text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-[#E60012] focus:ring-2 focus:ring-[#E60012]/15 transition"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="signup-email" className="block text-xs font-bold text-slate-700 mb-1">Email Address (Optional)</label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                    <Mail className="w-4 h-4" />
                  </div>
                  <input
                    id="signup-email"
                    name="email"
                    autoComplete="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="driver@company.com"
                    className="w-full pl-10 pr-3.5 py-2.5 rounded-xl border border-slate-200 bg-white font-medium text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-[#E60012] focus:ring-2 focus:ring-[#E60012]/15 transition"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="signup-password" className="block text-xs font-bold text-slate-700 mb-1">Password *</label>
                  <div className="relative">
                    <input
                      id="signup-password"
                      name="password"
                      autoComplete="new-password"
                      type={showSignupPassword ? 'text' : 'password'}
                      required
                      value={signupPassword}
                      onChange={(e) => setSignupPassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-white font-medium text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-[#E60012] focus:ring-2 focus:ring-[#E60012]/15 transition pr-8"
                    />
                    <button
                      type="button"
                      onClick={() => setShowSignupPassword(!showSignupPassword)}
                      className="absolute inset-y-0 right-0 pr-2.5 flex items-center text-slate-400 hover:text-slate-600 cursor-pointer"
                    >
                      {showSignupPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>

                <div>
                  <label htmlFor="signup-confirm-password" className="block text-xs font-bold text-slate-700 mb-1">Confirm Password *</label>
                  <div className="relative">
                    <input
                      id="signup-confirm-password"
                      name="confirm_password"
                      autoComplete="new-password"
                      type={showConfirmPassword ? 'text' : 'password'}
                      required
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-white font-medium text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-[#E60012] focus:ring-2 focus:ring-[#E60012]/15 transition pr-8"
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      className="absolute inset-y-0 right-0 pr-2.5 flex items-center text-slate-400 hover:text-slate-600 cursor-pointer"
                    >
                      {showConfirmPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 px-4 bg-[#E60012] hover:bg-[#CC0010] text-white font-extrabold text-xs rounded-xl shadow-xs transition flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 mt-2"
              >
                <span>{loading ? 'Creating Account...' : 'Create Account & Sign In'}</span>
              </button>
            </form>
          )}

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
