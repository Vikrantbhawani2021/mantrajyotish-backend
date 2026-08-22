const mongoose = require("mongoose");

const astrologerLoginSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            default: null,
            trim: true
        },

        email: {
            type: String,
            required: true,
            unique: true,
            lowercase: true,
            trim: true
        },

        phone: {
            type: String,
            default: null,
            trim: true,
            unique: true,
            sparse: true
        },

        password: {
            type: String,
            required: true
        }
    },
    {
        timestamps: true
    }
);

module.exports = mongoose.model(
    "AstrologerLogin",
    astrologerLoginSchema
);