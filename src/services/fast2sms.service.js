const getConfig = () => {
    const apiKey = process.env.FAST2SMS_API_KEY;
    const useMockOtp = process.env.USE_MOCK_OTP === "true";
    const isConfigured = Boolean(!useMockOtp && apiKey && apiKey.length > 5 && apiKey !== "your_fast2sms_api_key");

    return {
        apiKey,
        isConfigured
    };
};

/**
 * Send OTP to phone number using Fast2SMS bulkV2 OTP API
 * @param {string} phone - Mobile number (e.g. +919876543210 or 9876543210)
 * @param {string} otp - Numeric OTP code
 * @returns {Promise<{success: boolean, message: string, mock?: boolean, response?: any}>}
 */
const sendOtp = async (phone, otp) => {
    const config = getConfig();

    // Standardize phone number for Fast2SMS (strip non-digits and extract last 10 digits if it starts with 91)
    let cleanPhone = phone.replace(/\D/g, "");
    if (cleanPhone.startsWith("91") && cleanPhone.length > 10) {
        cleanPhone = cleanPhone.slice(-10);
    }

    if (!config.isConfigured) {
        console.log(`[DEVELOPMENT MOCK FAST2SMS] OTP for ${cleanPhone} is: ${otp}`);
        return {
            success: true,
            message: "OTP sent successfully (Development Mode)",
            mock: true,
            otp
        };
    }

    try {
        // Fast2SMS API v2 Quick SMS route to bypass website verification limits:
        const url = new URL("https://www.fast2sms.com/dev/bulkV2");
        url.searchParams.append("authorization", config.apiKey);
        url.searchParams.append("route", "q");
        url.searchParams.append("message", `Your Astro verification code is: ${otp}`);
        url.searchParams.append("numbers", cleanPhone);

        const response = await fetch(url.toString(), {
            method: "GET",
            headers: {
                "Accept": "application/json"
            }
        });

        const data = await response.json();

        if (!response.ok || !data.return) {
            throw new Error(data.message || `Fast2SMS API response status ${response.status}: ${JSON.stringify(data)}`);
        }

        console.log(`✉️ Fast2SMS OTP sent successfully to ${cleanPhone}. Message: ${data.message}`);
        return {
            success: true,
            message: "OTP sent successfully via Fast2SMS",
            response: data
        };
    } catch (error) {
        console.error("Fast2SMS sendOtp error:", error.message || error);
        throw error;
    }
};

module.exports = {
    sendOtp,
    isFast2SmsConfigured: () => getConfig().isConfigured
};
