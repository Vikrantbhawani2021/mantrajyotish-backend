const mongoose = require("mongoose");

const UserLoginSchema = new mongoose.Schema(
    {
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true
        },
        phone: {
            type: String,
            required: true,
            trim: true
        },
        email: {
            type: String,
            default: null,
            lowercase: true,
            trim: true
        },
        loginMethod: {
            type: String,
            enum: ["otp", "phone"],
            default: "otp"
        },
        lastLoginAt: {
            type: Date,
            default: Date.now
        }
    },
    {
        timestamps: true
    }
);

module.exports = mongoose.model("UserLogin", UserLoginSchema);
