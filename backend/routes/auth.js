const express = require("express");
const bcrypt = require("bcrypt");
const rateLimit = require("express-rate-limit");
const User = require("../models/User");
const authConfig = require("../config/authConfig");
const { sendOtpEmail } = require("../services/emailService");
const { generateNumericOtp, sha256, createResetSessionToken } = require("../services/otpService");
const { isEmail, normalizeEmail, isOtpCode, passwordRuleChecks, isStrongPassword } = require("../utils/validators");

const router = express.Router();

// IP-based rate limiting: max 10 OTP-related requests per IP per minute
const otpRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many requests from this IP. Please try again in a minute." },
});

const buildPasswordRuleMessage = () =>
  "Password must be at least 8 characters and include uppercase, lowercase, number, and special character.";

const now = () => new Date();
const maxAttempts = authConfig.otpMaxAttempts;

const clearPasswordResetState = (user) => {
  user.passwordReset = {
    otpHash: null,
    otpExpiresAt: null,
    otpAttempts: 0,
    otpVerifiedAt: null,
    resetSessionHash: null,
    resetSessionExpiresAt: null,
    lastOtpSentAt: null,
  };
};

const validateOtpForUser = async (user, otp) => {
  const resetState = user.passwordReset || {};

  if (!resetState.otpHash || !resetState.otpExpiresAt) {
    return { ok: false, status: 400, message: "No active OTP request found. Request a new code." };
  }

  if ((resetState.otpAttempts || 0) >= maxAttempts) {
    return { ok: false, status: 429, message: "Maximum OTP attempts reached. Request a new code." };
  }

  if (new Date(resetState.otpExpiresAt).getTime() <= now().getTime()) {
    user.passwordReset = { ...resetState, otpHash: null, otpExpiresAt: null, otpAttempts: 0 };
    await user.save();
    return { ok: false, status: 400, message: "OTP expired. Request a new code." };
  }

  if (sha256(otp) !== resetState.otpHash) {
    const nextAttempts = (resetState.otpAttempts || 0) + 1;
    user.passwordReset = { ...resetState, otpAttempts: nextAttempts };
    await user.save();
    const attemptsLeft = Math.max(0, maxAttempts - nextAttempts);
    return {
      ok: false,
      status: 400,
      message: attemptsLeft > 0
        ? `Invalid OTP. ${attemptsLeft} attempt(s) left.`
        : "Maximum OTP attempts reached. Request a new code.",
    };
  }

  return { ok: true, resetState };
};

router.post("/forgot-password", otpRateLimit, async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);

    if (!isEmail(email)) {
      return res.status(400).json({
        success: false,
        message: "Enter a valid email address.",
      });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "No account found with this email.",
      });
    }

    const currentReset = user.passwordReset || {};
    const resendCooldownMs = authConfig.otpResendCooldownSeconds * 1000;
    if (
      currentReset.lastOtpSentAt &&
      now().getTime() - new Date(currentReset.lastOtpSentAt).getTime() < resendCooldownMs
    ) {
      return res.status(429).json({
        success: false,
        message: `Please wait ${authConfig.otpResendCooldownSeconds} seconds before requesting a new code.`,
      });
    }

    const otp = generateNumericOtp(authConfig.otpLength);
    const otpExpiresAt = new Date(now().getTime() + authConfig.otpExpiryMinutes * 60 * 1000);

    user.passwordReset = {
      otpHash: sha256(otp),
      otpExpiresAt,
      otpAttempts: 0,
      otpVerifiedAt: null,
      resetSessionHash: null,
      resetSessionExpiresAt: null,
      lastOtpSentAt: now(),
    };

    await user.save();
    try {
      await sendOtpEmail({ to: user.email, otp });
    } catch (emailError) {
      console.error("forgot-password email error:", emailError);
      return res.status(503).json({
        success: false,
        message: "service unreachable",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Verification code sent to your email.",
      data: {
        email: user.email,
        otpExpiresInMinutes: authConfig.otpExpiryMinutes,
      },
    });
  } catch (error) {
    console.error("forgot-password error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to send verification code right now.",
    });
  }
});

router.post("/verify-otp", otpRateLimit, async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const otp = String(req.body?.otp || "").trim();

    if (!isEmail(email) || !isOtpCode(otp, authConfig.otpLength)) {
      return res.status(400).json({
        success: false,
        message: "Enter a valid email and OTP code.",
      });
    }

    const user = await User.findOne({ email });
    if (!user || !user.passwordReset?.otpHash || !user.passwordReset?.otpExpiresAt) {
      return res.status(400).json({
        success: false,
        message: "No active OTP request found. Request a new code.",
      });
    }

    const otpResult = await validateOtpForUser(user, otp);
    if (!otpResult.ok) {
      return res.status(otpResult.status).json({
        success: false,
        message: otpResult.message,
      });
    }

    const resetToken = createResetSessionToken();
    const resetSessionExpiresAt = new Date(now().getTime() + authConfig.resetSessionMinutes * 60 * 1000);

    user.passwordReset = {
      ...otpResult.resetState,
      otpHash: null,
      otpExpiresAt: null,
      otpAttempts: 0,
      otpVerifiedAt: now(),
      resetSessionHash: sha256(resetToken),
      resetSessionExpiresAt,
    };
    await user.save();

    return res.status(200).json({
      success: true,
      message: "OTP verified successfully.",
      data: {
        resetToken,
        resetTokenExpiresInMinutes: authConfig.resetSessionMinutes,
      },
    });
  } catch (error) {
    console.error("verify-otp error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to verify OTP right now.",
    });
  }
});

router.post("/reset-password", otpRateLimit, async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const otp = String(req.body?.otp || "").trim();
    const resetToken = String(req.body?.resetToken || "").trim();
    const newPassword = String(req.body?.newPassword || "");
    const confirmPassword = String(req.body?.confirmPassword || newPassword);

    if (!isEmail(email) || !newPassword || !confirmPassword) {
      return res.status(400).json({
        success: false,
        message: "Email and password fields are required.",
      });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({
        success: false,
        message: "Passwords do not match.",
      });
    }

    if (!isStrongPassword(newPassword)) {
      return res.status(400).json({
        success: false,
        message: buildPasswordRuleMessage(),
        passwordChecks: passwordRuleChecks(newPassword),
      });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "No account found with this email.",
      });
    }

    if (otp && resetToken) {
      return res.status(400).json({
        success: false,
        message: "Provide either OTP or reset token, not both.",
      });
    }

    if (otp) {
      if (!isOtpCode(otp, authConfig.otpLength)) {
        return res.status(400).json({
          success: false,
          message: "Invalid OTP.",
        });
      }

      const otpResult = await validateOtpForUser(user, otp);
      if (!otpResult.ok) {
        return res.status(otpResult.status).json({
          success: false,
          message: otpResult.message,
        });
      }

      user.passwordHash = await bcrypt.hash(newPassword, authConfig.bcryptSaltRounds);
      clearPasswordResetState(user);
      await user.save();

      return res.status(200).json({
        success: true,
        message: "Password reset successful.",
      });
    }

    if (!resetToken || !user.passwordReset?.resetSessionHash || !user.passwordReset?.resetSessionExpiresAt) {
      return res.status(400).json({
        success: false,
        message: "Invalid reset session. Provide OTP or verify OTP again.",
      });
    }

    const resetState = user.passwordReset;
    if (new Date(resetState.resetSessionExpiresAt).getTime() <= now().getTime()) {
      user.passwordReset = {
        ...resetState,
        resetSessionHash: null,
        resetSessionExpiresAt: null,
      };
      await user.save();
      return res.status(400).json({
        success: false,
        message: "Reset session expired. Verify OTP again.",
      });
    }

    if (sha256(resetToken) !== resetState.resetSessionHash) {
      return res.status(400).json({
        success: false,
        message: "Invalid reset token. Verify OTP again.",
      });
    }

    user.passwordHash = await bcrypt.hash(newPassword, authConfig.bcryptSaltRounds);
    clearPasswordResetState(user);
    await user.save();

    return res.status(200).json({
      success: true,
      message: "Password reset successful. Please log in.",
    });
  } catch (error) {
    console.error("reset-password error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to reset password right now.",
    });
  }
});

module.exports = router;
