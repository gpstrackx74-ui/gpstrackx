require('dotenv').config();
const https = require('https');

const APITXT_AUTH_KEY = process.env.APITXT_AUTH_KEY || '7In83Nb_BvbAhsBRtzoym6f_uqTJ2cK1zUI019sEDsE';

// In-memory OTP storage: phone -> { otp, expiresAt, verified, createdAt }
const otpStore = new Map();

function cleanPhoneNumber(phone) {
  if (!phone) return '';
  return String(phone).replace(/[^0-9]/g, '').slice(-10);
}

function formatMobileForApiTxt(phone) {
  if (!phone) return '';
  const digits = String(phone).replace(/[^0-9]/g, '');
  if (digits.length === 10) {
    return `91${digits}`;
  }
  if (digits.length === 12 && digits.startsWith('91')) {
    return digits;
  }
  if (digits.length > 10) {
    return `91${digits.slice(-10)}`;
  }
  return `91${digits}`;
}

// Generate 4-digit OTP code (e.g. 1000 - 9999)
function generateOtp() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

// Send OTP via ApiTxt API
async function sendSmsViaApiTxt(mobile, otp) {
  return new Promise((resolve) => {
    const url = `https://apitxt.com/api/sendOTP?authkey=${encodeURIComponent(APITXT_AUTH_KEY)}&mobile=${encodeURIComponent(mobile)}&otp=${encodeURIComponent(otp)}`;

    const req = https.get(url, { timeout: 10000 }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          console.log(`[ApiTxt sendOTP for ${mobile}]: Status ${res.statusCode}`, json);
          if (json.status === 'success' || res.statusCode === 200) {
            resolve({ success: true, message: json.message || 'OTP sent successfully', response: json });
          } else {
            resolve({
              success: false,
              message: json.message || 'Failed to send OTP via ApiTxt',
              response: json
            });
          }
        } catch {
          console.log(`[ApiTxt sendOTP raw response]:`, data);
          if (res.statusCode === 200) {
            resolve({ success: true, message: 'OTP sent successfully', raw: data });
          } else {
            resolve({ success: false, message: 'Invalid response from ApiTxt', raw: data });
          }
        }
      });
    });

    req.on('error', (err) => {
      console.error('[ApiTxt Network Error]:', err.message);
      resolve({ success: false, message: `ApiTxt connection failed: ${err.message}` });
    });

    req.on('timeout', () => {
      req.destroy();
      console.error('[ApiTxt Timeout]');
      resolve({ success: false, message: 'ApiTxt request timed out' });
    });
  });
}

const smsService = {
  // Send 4-digit OTP to mobile number via ApiTxt
  async sendOtp(rawPhone) {
    const phone = cleanPhoneNumber(rawPhone);
    if (!phone || phone.length !== 10) {
      throw new Error('Please enter a valid 10-digit Indian mobile number');
    }

    const otp = generateOtp();
    const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes expiry

    // Save in storage (keyed by clean 10-digit phone)
    otpStore.set(phone, {
      otp,
      expiresAt,
      verified: false,
      createdAt: new Date().toISOString()
    });

    const apiMobile = formatMobileForApiTxt(phone);
    console.log(`>>> [ApiTxt] Sending 4-digit OTP [${otp}] to ${apiMobile}...`);

    // Call ApiTxt sendOTP API
    const apiResult = await sendSmsViaApiTxt(apiMobile, otp);

    if (!apiResult.success) {
      throw new Error(apiResult.message || 'Failed to send SMS OTP. Please try again.');
    }

    return {
      success: true,
      phone,
      message: `OTP sent successfully to +91 ${phone} via SMS.`
    };
  },

  // Verify entered OTP
  verifyOtp(rawPhone, enteredOtp) {
    const phone = cleanPhoneNumber(rawPhone);
    if (!phone || !enteredOtp) {
      return { success: false, error: 'Mobile number and OTP are required' };
    }

    const record = otpStore.get(phone);
    if (!record) {
      return { success: false, error: 'No OTP requested for this number or OTP expired. Please click "Send OTP".' };
    }

    if (Date.now() > record.expiresAt) {
      otpStore.delete(phone);
      return { success: false, error: 'OTP has expired. Please request a new OTP.' };
    }

    if (String(record.otp).trim() !== String(enteredOtp).trim()) {
      return { success: false, error: 'Incorrect OTP. Please enter the valid 4-digit code.' };
    }

    // Mark as verified
    record.verified = true;
    otpStore.set(phone, record);

    return { success: true, message: 'Mobile number verified successfully!' };
  },

  // Check if phone was already verified
  isPhoneVerified(rawPhone) {
    const phone = cleanPhoneNumber(rawPhone);
    const record = otpStore.get(phone);
    return !!(record && record.verified && Date.now() <= record.expiresAt);
  },

  // Clear phone OTP state after registration/login
  consumePhoneOtp(rawPhone) {
    const phone = cleanPhoneNumber(rawPhone);
    otpStore.delete(phone);
  }
};

module.exports = smsService;
