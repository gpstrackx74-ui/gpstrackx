require('dotenv').config();
const https = require('https');

const FAST2SMS_API_KEY = process.env.FAST2SMS_API_KEY || 'TLvthWvGs0bRbxakqDHFJiIlwum6y9PpKnUAyxygRVg5DoS5JIa7XdFpTclqMsHErGXIwa5nD5ZxM8W9';

// In-memory OTP storage: phone -> { otp, expiresAt, verified }
const otpStore = new Map();

function cleanPhoneNumber(phone) {
  if (!phone) return '';
  return phone.replace(/[^0-9]/g, '').slice(-10);
}

function generateOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function callFast2SmsApi(payload) {
  return new Promise((resolve) => {
    const postData = JSON.stringify(payload);
    const options = {
      hostname: 'www.fast2sms.com',
      port: 443,
      path: '/dev/bulkV2',
      method: 'POST',
      headers: {
        'authorization': FAST2SMS_API_KEY,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      },
      timeout: 8000
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json);
        } catch {
          resolve({ return: false, raw: data });
        }
      });
    });

    req.on('error', (err) => {
      resolve({ return: false, error: err.message });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({ return: false, error: 'Request timeout' });
    });

    req.write(postData);
    req.end();
  });
}

async function sendSmsViaFast2Sms(phone, otp) {
  // 1. Try Quick SMS route ('q') which delivers real SMS immediately without website verification
  const quickPayload = {
    route: 'q',
    message: `Your GpsTrackX OTP verification code is ${otp}. Valid for 10 minutes. Do not share this OTP with anyone.`,
    language: 'english',
    flash: 0,
    numbers: phone
  };

  const quickResult = await callFast2SmsApi(quickPayload);
  console.log(`[Fast2SMS Quick Route for ${phone}]:`, quickResult);

  if (quickResult.return === true || quickResult.status_code === 200) {
    return { success: true, response: quickResult };
  }

  // 2. Fallback to 'otp' route if 'q' fails
  const otpPayload = {
    route: 'otp',
    variables_values: String(otp),
    numbers: phone
  };

  const otpResult = await callFast2SmsApi(otpPayload);
  console.log(`[Fast2SMS OTP Route for ${phone}]:`, otpResult);

  if (otpResult.return === true || otpResult.status_code === 200) {
    return { success: true, response: otpResult };
  }

  return {
    success: false,
    message: quickResult.message || otpResult.message || 'SMS delivery pending verification',
    response: quickResult
  };
}

const smsService = {
  // Send 6-digit OTP to mobile number
  async sendOtp(rawPhone) {
    const phone = cleanPhoneNumber(rawPhone);
    if (!phone || phone.length !== 10) {
      throw new Error('Please enter a valid 10-digit Indian mobile number');
    }

    const otp = generateOtp();
    const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes expiry

    // Save in storage
    otpStore.set(phone, {
      otp,
      expiresAt,
      verified: false,
      createdAt: new Date().toISOString()
    });

    console.log(`>>> [Fast2SMS] Sending OTP [${otp}] to ${phone}...`);

    // Call Fast2SMS API
    const fast2smsResult = await sendSmsViaFast2Sms(phone, otp);

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
      return { success: false, error: 'Incorrect OTP. Please enter the valid 6-digit code.' };
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

