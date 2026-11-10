import React, { useState, useEffect, useRef } from 'react';
import { LogoIntro } from '../components/LogoIntro';
import {
  Shield,
  MapPin,
  Truck,
  ArrowRight,
  CheckCircle,
  Clock,
  Radio,
  Building2,
  Menu,
  X,
  Gauge,
  Cpu,
  Layers,
  ChevronRight,
  Flag,
  ShoppingCart,
  Phone,
  Check
} from 'lucide-react';
import { InteractiveMap } from '../components/InteractiveMap';

interface LandingPageProps {
  onSignIn: () => void;
  onSignUp: () => void;
}

export const LandingPage: React.FC<LandingPageProps> = ({ onSignIn, onSignUp }) => {
  const [showIntro, setShowIntro] = useState(true);
  const [animStage, setAnimStage] = useState(0);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [selectedDeviceForBuy, setSelectedDeviceForBuy] = useState<any | null>(null);
  const [buyOrderSuccess, setBuyOrderSuccess] = useState(false);
  const [buyerForm, setBuyerForm] = useState({ name: '', phone: '', address: '', quantity: '1' });
  const heroVideoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = heroVideoRef.current;
    if (video) {
      video.muted = true;
      video.defaultMuted = true;
      video.playsInline = true;
      const playPromise = video.play();
      if (playPromise !== undefined) {
        playPromise.catch(() => {
          const tryPlay = () => {
            if (video) video.play();
            window.removeEventListener('click', tryPlay);
            window.removeEventListener('touchstart', tryPlay);
          };
          window.addEventListener('click', tryPlay, { once: true });
          window.addEventListener('touchstart', tryPlay, { once: true });
        });
      }
    }
  }, [showIntro]);

  const headlineLine1 = [
    { text: 'Smarter', highlight: true },
    { text: 'Fleet', highlight: false },
    { text: 'Operations.', highlight: false }
  ];

  const headlineLine2 = [
    { text: 'Every', highlight: false },
    { text: 'Journey', highlight: false },
    { text: 'Under', highlight: false },
    { text: 'Control.', highlight: true }
  ];

  // Staggered Entrance Animation Sequence (starts as soon as video intro finishes)
  useEffect(() => {
    if (showIntro) return;

    setAnimStage(0);
    const t1 = setTimeout(() => setAnimStage(1), 150);  // Line 1 words
    const t2 = setTimeout(() => setAnimStage(2), 600);  // Line 2 words
    const t3 = setTimeout(() => setAnimStage(3), 1050); // Description
    const t4 = setTimeout(() => setAnimStage(4), 1350); // Visual & CTAs

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      clearTimeout(t4);
    };
  }, [showIntro]);

  const gpsDevices = [
    {
      id: 'ais140',
      title: 'AIS-140 Certified Commercial Fleet Tracker',
      category: 'Govt. Approved & Mining',
      price: '₹3,499',
      features: [
        'Dual SMA GNSS + 4G LTE High-Gain Antennas',
        'Emergency SOS Panic Button & Alarm Wiring',
        'IP67 Waterproof & Dustproof Rugged Metal Casing',
        'Full RTO / VLT Govt. Regulatory Compliance'
      ],
      description: 'Heavy-duty certified telematics unit engineered for commercial trucks, tippers, container carriers, and school buses.',
      image: '/images/gps-device-ais140.png'
    },
    {
      id: 'obd',
      title: 'OBD-II Plug & Play Vehicle Tracker',
      category: 'Cars, Taxis & Light Freight',
      price: '₹1,999',
      features: [
        '5-Second OBD Port Plug-In (Zero Wire Cutting)',
        '100% Safe (Does Not Void Vehicle Warranty)',
        'Live Engine Diagnostics & Trouble Codes (DTC)',
        'Speeding, Harsh Braking & Trip Analytics'
      ],
      description: 'Instant plug-in GPS tracker for commercial delivery vans, corporate fleet cars, and app-based cabs.',
      image: '/images/gps-device-obd.png'
    },
    {
      id: 'magnetic',
      title: 'Heavy-Duty Magnetic Asset & Cargo Tracker',
      category: 'Containers & Long-Haul Cargo',
      price: '₹4,299',
      features: [
        'Ultra-Strong Neodymium Magnetic Base Plates',
        '10,000mAh Battery (30+ Days Continuous Standby)',
        'IP68 Submersible Waterproof & Shockproof Body',
        'Light-Sensor Anti-Tamper & Drop-Off Alert'
      ],
      description: 'Standalone wireless GPS tracker for maritime containers, railway freight, machinery, and high-value cargo.',
      image: '/images/gps-device-magnetic.png'
    },
    {
      id: 'hardwired',
      title: 'Slim Hardwired Tracker + Engine Cut-Off',
      category: 'Commercial Trucks & Motorbikes',
      price: '₹2,799',
      features: [
        'Remote Engine Cut-Off / Anti-Theft Relay',
        '9V-90V Universal Wide Working Voltage',
        'Ignition Key ACC Detection & Towing Alert',
        'Compact Discrete Design with Internal Battery'
      ],
      description: 'Compact hardwired GPS unit with remote vehicle immobilizer, ideal for logistics fleet trucks and bikes.',
      image: '/images/gps-device-hardwired.png'
    }
  ];

  const handleOrderSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!buyerForm.name || !buyerForm.phone) {
      alert('Please enter your Name and Mobile Number.');
      return;
    }
    setBuyOrderSuccess(true);
    setTimeout(() => {
      setBuyOrderSuccess(false);
      setSelectedDeviceForBuy(null);
      setBuyerForm({ name: '', phone: '', address: '', quantity: '1' });
    }, 2800);
  };

  return (
    <>
      {/* 1. Cinematic Brand Logo Video Intro Overlay */}
      {showIntro && (
        <LogoIntro 
          videoSrc="/logoweb.mp4" 
          onComplete={() => setShowIntro(false)} 
        />
      )}

      <div className={`min-h-screen bg-white text-[#101828] font-sans antialiased selection:bg-[#E60012]/10 selection:text-[#E60012] transition-opacity duration-700 ${showIntro ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
        {/* 1. Header Navigation Bar */}
        <header className="sticky top-0 z-50 bg-white/95 backdrop-blur-md border-b border-[#E5E7EB]">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-20 flex items-center justify-between">
            {/* Brand Logo (Click to replay video intro) */}
            <button
              type="button"
              onClick={() => setShowIntro(true)}
              title="Click to replay logo video intro"
              className="flex items-center gap-3 group text-left cursor-pointer"
            >
              <img
                src="/gpstrackx-brand.png"
                alt="GpsTrackX Brand"
                className="h-10 w-auto object-contain group-hover:opacity-85 transition-opacity"
              />
            </button>

          {/* Desktop Nav Links */}
          <nav className="hidden md:flex items-center gap-8 text-xs font-semibold text-[#101828]/70">
            <a href="#devices" className="hover:text-[#E60012] transition-colors">
              GPS Hardware
            </a>
            <a href="#features" className="hover:text-[#E60012] transition-colors">
              Features
            </a>
            <a href="#route-tracking" className="hover:text-[#E60012] transition-colors">
              Route Telemetry
            </a>
            <a href="#about" className="hover:text-[#E60012] transition-colors">
              About
            </a>
          </nav>

          {/* Right Action Buttons */}
          <div className="hidden md:flex items-center gap-3">
            <button
              type="button"
              onClick={onSignIn}
              className="text-xs font-bold text-[#101828] hover:text-[#E60012] px-4 py-2.5 rounded-xl transition cursor-pointer"
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={onSignUp}
              className="text-xs font-bold text-white bg-[#E60012] hover:bg-[#CC0010] px-5 py-2.5 rounded-xl shadow-xs transition flex items-center gap-1.5 cursor-pointer"
            >
              <span>Get Started</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Mobile Menu Toggle */}
          <button
            type="button"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="md:hidden p-2 rounded-xl text-slate-600 hover:bg-slate-100 transition"
          >
            {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>

        {/* Mobile Dropdown */}
        {mobileMenuOpen && (
          <div className="md:hidden bg-white border-b border-[#E5E7EB] px-4 py-5 space-y-3 shadow-lg">
            <a
              href="#devices"
              onClick={() => setMobileMenuOpen(false)}
              className="block text-xs font-bold text-slate-800 py-1.5"
            >
              GPS Hardware
            </a>
            <a
              href="#features"
              onClick={() => setMobileMenuOpen(false)}
              className="block text-xs font-bold text-slate-800 py-1.5"
            >
              Features
            </a>
            <a
              href="#route-tracking"
              onClick={() => setMobileMenuOpen(false)}
              className="block text-xs font-bold text-slate-800 py-1.5"
            >
              Route Telemetry
            </a>
            <a
              href="#about"
              onClick={() => setMobileMenuOpen(false)}
              className="block text-xs font-bold text-slate-800 py-1.5"
            >
              About
            </a>
            <div className="pt-3 border-t border-slate-100 flex items-center gap-2">
              <button
                type="button"
                onClick={onSignIn}
                className="flex-1 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-800"
              >
                Sign In
              </button>
              <button
                type="button"
                onClick={onSignUp}
                className="flex-1 py-2 rounded-xl bg-[#E60012] text-white text-xs font-bold"
              >
                Get Started
              </button>
            </div>
          </div>
        )}
      </header>

      {/* 2. Hero Section – Looping Background Video & First Impression */}
      <section className="relative min-h-[580px] lg:min-h-[660px] flex items-center border-b border-[#E5E7EB] overflow-hidden bg-[#101828]">
        {/* Background Video Layer */}
        <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
          <video
            ref={heroVideoRef}
            autoPlay
            loop
            muted
            playsInline
            src="/hero-video.mp4"
            onCanPlay={(e) => {
              const v = e.currentTarget;
              v.muted = true;
              v.play().catch(() => {});
            }}
            className="w-full h-full object-cover opacity-90 scale-105 transition-opacity duration-700"
          >
            <source src="/hero-video.mp4" type="video/mp4" />
          </video>
          {/* Lightened, High-Clarity Overlay to make background video vivid & clearly visible */}
          <div className="absolute inset-0 bg-gradient-to-r from-[#101828]/75 via-[#101828]/40 to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-t from-[#101828]/50 via-transparent to-transparent opacity-40" />
        </div>

        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 sm:py-28 w-full">
          <div className="max-w-3xl">
            {/* Word-by-Word Reveal Headline */}
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-black text-white tracking-tight leading-[1.08] sm:leading-[1.08] drop-shadow-md">
              {/* Line 1 */}
              <div className="block overflow-hidden pb-1">
                {headlineLine1.map((item, idx) => (
                  <span
                    key={idx}
                    className={`inline-block mr-3 transition-all duration-700 ease-out ${
                      animStage >= 1 ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
                    } ${item.highlight ? 'text-[#E60012]' : 'text-white'}`}
                    style={{ transitionDelay: `${idx * 110}ms` }}
                  >
                    {item.text}
                  </span>
                ))}
              </div>

              {/* Line 2 */}
              <div className="block overflow-hidden">
                {headlineLine2.map((item, idx) => (
                  <span
                    key={idx}
                    className={`inline-block mr-3 transition-all duration-700 ease-out ${
                      animStage >= 2 ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
                    } ${item.highlight ? 'text-[#E60012]' : 'text-white'}`}
                    style={{ transitionDelay: `${idx * 110}ms` }}
                  >
                    {item.text}
                  </span>
                ))}
              </div>
            </h1>

            {/* Supporting Description */}
            <p
              className={`mt-6 text-base sm:text-lg text-white font-medium drop-shadow-sm leading-relaxed max-w-2xl transition-all duration-800 ease-out ${
                animStage >= 3 ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3'
              }`}
            >
              Intelligent GPS tracking, route analytics, vehicle monitoring and FASTag toll management — bringing complete fleet visibility into one powerful platform.
            </p>

            {/* Action Buttons */}
            <div
              className={`mt-8 flex flex-wrap items-center gap-3.5 transition-all duration-700 ease-out ${
                animStage >= 4 ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3'
              }`}
            >
              <button
                type="button"
                onClick={onSignUp}
                className="px-6 py-3.5 bg-[#E60012] hover:bg-[#c80010] text-white font-bold text-xs sm:text-sm rounded-xl transition shadow-lg shadow-[#E60012]/20 flex items-center gap-2 cursor-pointer"
              >
                <span>Get Started</span>
                <ArrowRight className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={onSignIn}
                className="px-6 py-3.5 bg-white/10 hover:bg-white/20 text-white font-bold text-xs sm:text-sm rounded-xl border border-white/20 transition backdrop-blur-sm cursor-pointer"
              >
                Sign In to Platform
              </button>

              <a
                href="#devices"
                className="px-6 py-3.5 bg-white/10 hover:bg-white/20 text-white font-bold text-xs sm:text-sm rounded-xl border border-white/20 transition backdrop-blur-sm flex items-center gap-2 cursor-pointer"
              >
                <ShoppingCart className="w-4 h-4 text-[#E60012]" />
                <span>Buy GPS Devices</span>
              </a>
            </div>

            {/* Micro Telematics Live Indicator */}
            <div
              className={`mt-10 flex flex-wrap items-center gap-6 text-xs text-white/60 font-mono transition-all duration-700 ease-out ${
                animStage >= 4 ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3'
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-white/80">Live GPS Telemetry Active</span>
              </div>
              <div className="hidden sm:flex items-center gap-2">
                <span className="text-white/30">•</span>
                <span>Sub-Second Latency</span>
              </div>
              <div className="hidden sm:flex items-center gap-2">
                <span className="text-white/30">•</span>
                <span>AIS-140 Certified</span>
              </div>
              <div className="hidden sm:flex items-center gap-2">
                <span className="text-white/30">•</span>
                <span>FASTag Integrated</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 3. GPS Hardware & Buy Section */}
      <section id="devices" className="py-20 sm:py-24 bg-[#F8FAFC] border-b border-[#E5E7EB]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <span className="text-[11px] font-bold uppercase tracking-wider text-[#E60012]">
              Industrial Telematics Hardware
            </span>
            <h2 className="text-3xl sm:text-4xl font-black text-[#101828] tracking-tight mt-1.5">
              High-Precision Commercial GPS Devices
            </h2>
            <p className="text-sm sm:text-base text-[#101828]/70 mt-3 leading-relaxed">
              Order enterprise-grade commercial GPS tracking hardware pre-configured with the GpsTrackX cloud platform. Free SIM card & ready to track out-of-the-box.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {gpsDevices.map((device) => (
              <div
                key={device.id}
                className="bg-white rounded-3xl border border-slate-200/90 shadow-xs hover:shadow-xl hover:border-red-200 transition-all flex flex-col justify-between overflow-hidden group"
              >
                <div>
                  {/* Studio Image Container */}
                  <div className="relative h-56 bg-slate-50 flex items-center justify-center p-6 border-b border-slate-100 overflow-hidden">
                    <img
                      src={device.image}
                      alt={device.title}
                      className="max-h-full max-w-full object-contain group-hover:scale-105 transition-transform duration-300 drop-shadow-md"
                    />
                    <span className="absolute top-3 left-3 text-[10px] font-mono font-bold uppercase px-2.5 py-0.5 rounded-full bg-white/90 text-slate-800 border border-slate-200 shadow-2xs">
                      {device.category}
                    </span>
                  </div>

                  {/* Body Content */}
                  <div className="p-5 space-y-3">
                    <div className="flex items-baseline justify-between">
                      <span className="text-2xl font-black font-mono text-slate-900">{device.price}</span>
                      <span className="text-[11px] text-slate-400 font-medium">Inc. 18% GST</span>
                    </div>

                    <h3 className="font-extrabold text-sm text-slate-900 leading-snug">
                      {device.title}
                    </h3>

                    <p className="text-xs text-slate-500 leading-relaxed">
                      {device.description}
                    </p>

                    <div className="pt-2 border-t border-slate-100 space-y-1.5">
                      {device.features.map((feat, idx) => (
                        <div key={idx} className="flex items-start gap-1.5 text-[11px] text-slate-600">
                          <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
                          <span>{feat}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Buy Button */}
                <div className="p-5 pt-0">
                  <button
                    type="button"
                    onClick={() => setSelectedDeviceForBuy(device)}
                    className="w-full py-2.5 rounded-xl bg-[#E60012] hover:bg-[#CC0010] text-white font-extrabold text-xs uppercase tracking-wider transition shadow-2xs flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <ShoppingCart className="w-3.5 h-3.5 text-white" />
                    <span>Buy Now</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 4. Core Fleet Platform Capabilities */}
      <section id="features" className="py-20 sm:py-24 bg-white border-b border-[#E5E7EB]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <span className="text-[11px] font-bold uppercase tracking-wider text-[#E60012]">
              Fleet Telematics Suite
            </span>
            <h2 className="text-3xl sm:text-4xl font-black text-[#101828] tracking-tight mt-1.5">
              Engineered For Modern Commercial Fleets
            </h2>
            <p className="text-sm sm:text-base text-[#101828]/70 mt-3 leading-relaxed">
              From heavy freight haulers to urban delivery vehicles, GpsTrackX gives you reliable tools to stay in control of your fleet 24/7.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            <div className="p-6 rounded-2xl bg-white border border-[#E5E7EB] hover:border-slate-300 shadow-xs space-y-3">
              <div className="w-10 h-10 rounded-xl bg-red-50 text-[#E60012] flex items-center justify-center font-bold">
                <MapPin className="w-5 h-5" />
              </div>
              <h3 className="font-extrabold text-base text-slate-900">Real-Time GPS Tracking</h3>
              <p className="text-xs text-slate-500 leading-relaxed">
                Live location streaming via Google Maps Platform API with sub-second position latency, heading angle, and speed reporting.
              </p>
            </div>

            <div className="p-6 rounded-2xl bg-white border border-[#E5E7EB] hover:border-slate-300 shadow-xs space-y-3">
              <div className="w-10 h-10 rounded-xl bg-slate-100 text-slate-800 flex items-center justify-center font-bold">
                <Layers className="w-5 h-5" />
              </div>
              <h3 className="font-extrabold text-base text-slate-900">Excel Highway Route Import</h3>
              <p className="text-xs text-slate-500 leading-relaxed">
                Upload Excel (.xlsx, .csv) files containing latitude and longitude coordinates to automatically generate highway corridors with stoppages.
              </p>
            </div>

            <div className="p-6 rounded-2xl bg-white border border-[#E5E7EB] hover:border-slate-300 shadow-xs space-y-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center font-bold">
                <Gauge className="w-5 h-5" />
              </div>
              <h3 className="font-extrabold text-base text-slate-900">Live Speed & Stoppage Auditing</h3>
              <p className="text-xs text-slate-500 leading-relaxed">
                Automated stoppage calculation, scheduled trip windows, arrival/departure timestamps, and driver rest bay tracking.
              </p>
            </div>

            <div className="p-6 rounded-2xl bg-white border border-[#E5E7EB] hover:border-slate-300 shadow-xs space-y-3">
              <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center font-bold">
                <Truck className="w-5 h-5" />
              </div>
              <h3 className="font-extrabold text-base text-slate-900">Commercial Axle Classification</h3>
              <p className="text-xs text-slate-500 leading-relaxed">
                Comprehensive classification covering 2-axle to 7-axle heavy trucks, trailers, container haulers, and tippers.
              </p>
            </div>

            <div className="p-6 rounded-2xl bg-white border border-[#E5E7EB] hover:border-slate-300 shadow-xs space-y-3">
              <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center font-bold">
                <Cpu className="w-5 h-5" />
              </div>
              <h3 className="font-extrabold text-base text-slate-900">Route Motion Playback</h3>
              <p className="text-xs text-slate-500 leading-relaxed">
                Smooth route simulation ticker with speed scrubbing (1x, 2x, 5x, 10x) allowing administrators to audit historical trip journeys.
              </p>
            </div>

            <div className="p-6 rounded-2xl bg-white border border-[#E5E7EB] hover:border-slate-300 shadow-xs space-y-3">
              <div className="w-10 h-10 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center font-bold">
                <Shield className="w-5 h-5" />
              </div>
              <h3 className="font-extrabold text-base text-slate-900">Role-Based Access Control</h3>
              <p className="text-xs text-slate-500 leading-relaxed">
                Secure Super Admin and Fleet User role boundaries. Drivers and operators access their allocated vehicle telemetry directly.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 5. Intelligent Route Tracking Preview */}
      <section id="route-tracking" className="py-20 sm:py-24 bg-[#F5F6F8] border-b border-[#E5E7EB]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-2xl mb-12">
            <span className="text-[11px] font-bold uppercase tracking-wider text-[#E60012]">
              Route Telemetry
            </span>
            <h2 className="text-3xl sm:text-4xl font-black text-[#101828] tracking-tight mt-1.5">
              Every Route. Every Stop. Every Detail.
            </h2>
            <p className="text-sm text-[#101828]/70 mt-3 leading-relaxed">
              Understand vehicle journeys with detailed route history, GPS movement, stoppage duration, and trip-level highway insights.
            </p>
          </div>

          {/* Wide Map-Based Visual */}
          <div className="bg-white rounded-3xl border border-[#E5E7EB] overflow-hidden shadow-md">
            {/* Toolbar */}
            <div className="p-4 border-b border-[#E5E7EB] bg-white flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-3">
                <span className="font-bold text-[#101828]">Active Road Corridor: Mumbai Port → Pune Swargate</span>
                <span className="text-[#101828]/30">|</span>
                <span className="font-mono text-[#101828]/70">148.2 km • ~3h 45m</span>
              </div>

              <div className="flex items-center gap-2">
                <span className="flex items-center gap-1.5 text-xs text-[#101828] font-medium bg-[#F5F6F8] px-2.5 py-1 rounded-lg border border-[#E5E7EB]">
                  <Flag className="w-3.5 h-3.5 text-emerald-600 fill-emerald-600" /> Start (Green Flag)
                </span>
                <span className="flex items-center gap-1.5 text-xs text-[#101828] font-medium bg-[#F5F6F8] px-2.5 py-1 rounded-lg border border-[#E5E7EB]">
                  <Flag className="w-3.5 h-3.5 text-[#E60012] fill-[#E60012]" /> Destination (Red Flag)
                </span>
              </div>
            </div>

            {/* Embedded Interactive Map */}
            <div className="relative">
              <InteractiveMap
                height="450px"
                center={[18.9220, 73.3500]}
                zoom={9}
                routes={[
                  {
                    id: 'landing-preview-1',
                    name: 'Mumbai Port to Pune Swargate Express Corridor',
                    distanceKm: 148.2,
                    timeMinutes: 225,
                    tollGatesCount: 3,
                    stopsCount: 2,
                    summary: 'Direct Highway Corridor via Mumbai-Pune Expressway',
                    color: '#E60012',
                    coordinates: [
                      [18.9400, 72.8350],
                      [18.9800, 72.8800],
                      [19.0330, 73.0297],
                      [19.0144, 73.1030],
                      [18.8950, 73.2300],
                      [18.7500, 73.4000],
                      [18.6500, 73.7500],
                      [18.5204, 73.8567]
                    ]
                  }
                ]}
                selectedRouteId="landing-preview-1"
                startPoint={{ lat: 18.9400, lng: 72.8350, name: 'Mumbai CST Freight Terminal' }}
                endPoint={{ lat: 18.5204, lng: 73.8567, name: 'Pune Swargate Logistics Depot' }}
                stoppages={[
                  { id: 1, sequence_order: 1, name: 'Navi Mumbai Hub', lat: 19.0330, lng: 73.0297, stop_duration_mins: 20 },
                  { id: 2, sequence_order: 2, name: 'Lonavala Ghat Rest Bay', lat: 18.7500, lng: 73.4000, stop_duration_mins: 30 }
                ]}
                tollGates={[
                  { id: 1, name: 'Khalapur Toll Plaza', lat: 18.8950, lng: 73.2300, charges: 340, is_manual: false, toll_type: 'FASTag ETC' },
                  { id: 2, name: 'Talegaon Toll Plaza', lat: 18.6500, lng: 73.7500, charges: 215, is_manual: false, toll_type: 'FASTag ETC' }
                ]}
                vehiclePosition={{
                  lat: 18.8950,
                  lng: 73.2300,
                  plate: 'MH12-RN-4589',
                  speed: 61,
                  status: 'moving'
                }}
              />
            </div>
          </div>
        </div>
      </section>

      {/* 6. About GpsTrackX */}
      <section id="about" className="py-20 sm:py-24 bg-white border-b border-[#E5E7EB]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-3xl">
            <span className="text-[11px] font-bold uppercase tracking-wider text-[#E60012]">
              About GpsTrackX
            </span>
            <h2 className="text-3xl sm:text-4xl font-black text-[#101828] tracking-tight mt-1.5">
              Technology That Keeps Commercial Fleets Moving.
            </h2>
            <p className="text-base text-[#101828]/70 mt-4 leading-relaxed">
              GpsTrackX is a next-generation commercial vehicle tracking and telematics management platform built to help fleet owners, logistics operators, and enterprises streamline vehicle movement, monitor live speeds, allocate highway routes, and maintain absolute visibility over transport assets.
            </p>

            <div className="mt-8 pt-6 border-t border-[#E5E7EB] flex flex-wrap items-center gap-8 text-xs text-[#101828]/70">
              <div className="flex items-center gap-2">
                <Building2 className="w-4 h-4 text-[#101828]" />
                <span>Enterprise Telematics Cloud Platform</span>
              </div>
              <div className="flex items-center gap-2">
                <Shield className="w-4 h-4 text-[#101828]" />
                <span>Certified Indian Commercial Standards</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 7. Footer */}
      <footer className="bg-[#101828] text-white pt-16 pb-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-10 pb-12 border-b border-white/10">
            <div className="space-y-4">
              <img
                src="/gpstrackx-brand.png"
                alt="GpsTrackX Brand"
                className="h-8 w-auto object-contain brightness-0 invert"
              />
              <p className="text-xs text-white/60 leading-relaxed">
                Complete fleet tracking, highway route allocation, and industrial GPS telematics solution for transport businesses.
              </p>
            </div>

            <div>
              <h5 className="font-bold text-xs uppercase tracking-wider text-white/40 mb-3">Quick Navigation</h5>
              <ul className="space-y-2 text-xs text-white/70">
                <li><a href="#devices" className="hover:text-white transition">Buy GPS Devices</a></li>
                <li><a href="#features" className="hover:text-white transition">Platform Features</a></li>
                <li><a href="#route-tracking" className="hover:text-white transition">Live Route Telemetry</a></li>
                <li><a href="#about" className="hover:text-white transition">About Us</a></li>
              </ul>
            </div>

            <div>
              <h5 className="font-bold text-xs uppercase tracking-wider text-white/40 mb-3">Portal Access</h5>
              <ul className="space-y-2 text-xs text-white/70">
                <li><button type="button" onClick={onSignIn} className="hover:text-white transition cursor-pointer">Fleet User Sign In</button></li>
                <li><button type="button" onClick={onSignUp} className="hover:text-white transition cursor-pointer">Register New Account</button></li>
              </ul>
            </div>

            <div>
              <h5 className="font-bold text-xs uppercase tracking-wider text-white/40 mb-3">Security & Compliance</h5>
              <p className="text-xs text-white/60 leading-relaxed">
                Full AIS-140 compliance, encrypted telemetry links, and multi-tenant access control for Indian fleet operations.
              </p>
            </div>
          </div>

          <div className="pt-8 flex flex-col sm:flex-row sm:items-center justify-between text-xs text-white/40 gap-4">
            <p>© {new Date().getFullYear()} GpsTrackX Fleet Systems. All rights reserved.</p>
            <p>High-Precision Real-Time Telematics & Commercial Highway Engine</p>
          </div>
        </div>
      </footer>

      {/* Buy GPS Device Modal */}
      {selectedDeviceForBuy && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-slate-200 relative">
            <button
              type="button"
              onClick={() => setSelectedDeviceForBuy(null)}
              className="absolute top-4 right-4 w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center text-sm transition cursor-pointer"
            >
              ✕
            </button>

            {buyOrderSuccess ? (
              <div className="text-center py-6 space-y-3">
                <div className="w-14 h-14 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto text-2xl">
                  ✓
                </div>
                <h3 className="font-extrabold text-slate-900 text-lg">Order Inquiry Received!</h3>
                <p className="text-xs text-slate-500">
                  Thank you, <strong>{buyerForm.name}</strong>. Our hardware sales team will contact you at <strong>{buyerForm.phone}</strong> with dispatch details for {buyerForm.quantity} unit(s) of <strong>{selectedDeviceForBuy.title}</strong>.
                </p>
              </div>
            ) : (
              <div>
                <div className="flex items-center gap-3 pb-3 border-b border-slate-100">
                  <div className="w-12 h-12 rounded-xl bg-slate-50 p-1 flex items-center justify-center border border-slate-200">
                    <img src={selectedDeviceForBuy.image} alt={selectedDeviceForBuy.title} className="max-h-full max-w-full object-contain" />
                  </div>
                  <div>
                    <span className="text-[10px] font-bold uppercase text-[#E60012]">{selectedDeviceForBuy.category}</span>
                    <h3 className="font-extrabold text-sm text-slate-900">{selectedDeviceForBuy.title}</h3>
                    <span className="font-mono font-black text-base text-slate-900">{selectedDeviceForBuy.price}</span>
                  </div>
                </div>

                <form onSubmit={handleOrderSubmit} className="mt-4 space-y-3 text-xs">
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">Your Full Name *</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Ramesh Patel"
                      value={buyerForm.name}
                      onChange={(e) => setBuyerForm({ ...buyerForm, name: e.target.value })}
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 text-slate-900 focus:outline-none focus:border-[#E60012]"
                    />
                  </div>

                  <div>
                    <label className="block font-bold text-slate-700 mb-1">Mobile / WhatsApp Number *</label>
                    <input
                      type="tel"
                      required
                      placeholder="e.g. 9876543210"
                      value={buyerForm.phone}
                      onChange={(e) => setBuyerForm({ ...buyerForm, phone: e.target.value })}
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 text-slate-900 font-mono focus:outline-none focus:border-[#E60012]"
                    />
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    <div className="col-span-1">
                      <label className="block font-bold text-slate-700 mb-1">Quantity</label>
                      <input
                        type="number"
                        min="1"
                        max="100"
                        value={buyerForm.quantity}
                        onChange={(e) => setBuyerForm({ ...buyerForm, quantity: e.target.value })}
                        className="w-full px-3 py-2 rounded-xl border border-slate-200 text-slate-900 font-mono focus:outline-none focus:border-[#E60012]"
                      />
                    </div>
                    <div className="col-span-2">
                      <label className="block font-bold text-slate-700 mb-1">Delivery City / State</label>
                      <input
                        type="text"
                        placeholder="e.g. Raipur, CG"
                        value={buyerForm.address}
                        onChange={(e) => setBuyerForm({ ...buyerForm, address: e.target.value })}
                        className="w-full px-3 py-2 rounded-xl border border-slate-200 text-slate-900 focus:outline-none focus:border-[#E60012]"
                      />
                    </div>
                  </div>

                  <div className="pt-2">
                    <button
                      type="submit"
                      className="w-full py-2.5 rounded-xl bg-[#E60012] hover:bg-[#CC0010] text-white font-extrabold text-xs uppercase tracking-wider transition shadow-xs cursor-pointer"
                    >
                      Confirm Order Inquiry
                    </button>
                    <p className="text-[10px] text-slate-400 text-center mt-2">
                      Instant response • Cash on Delivery / GST Invoice Available
                    </p>
                  </div>
                </form>
              </div>
            )}
          </div>
        </div>
      )}
      </div>
    </>
  );
};
