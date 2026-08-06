const mongoose = require("mongoose");

const UserSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      default: null,
      trim: true,
    },

    uniqueId: {
      type: String,
      unique: true,
      sparse: true,
      trim: true,
    },

    firstname: {
      type: String,
      default: null,
      trim: true,
    },

    middlename: {
      type: String,
      default: null,
      trim: true,
    },

    lastname: {
      type: String,
      default: null,
      trim: true,
    },

    gender: {
      type: String,
      enum: ["male", "female", "other"],
      default: null,
      lowercase: true,
      trim: true,
    },

    dateofbirth: {
      type: Date,
      default: null,
    },

    timeofbirth: {
      type: String,
      default: null,
      trim: true,
    },

    placeofbirth: {
      type: String,
      default: null,
      trim: true,
    },

    city: {
      type: String,
      default: null,
      trim: true,
    },

    state: {
      type: String,
      default: null,
      trim: true,
    },

    country: {
      type: String,
      default: null,
      trim: true,
    },

    address: {
      type: String,
      default: null,
      trim: true,
    },

    phone: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },

    email: {
      type: String,
      unique: true,
      lowercase: true,
      trim: true,
      sparse: true,
    },

    role: {
      type: String,
      enum: ["user", "astrologer", "admin"],
      default: "user",
    },

    isProfileCompleted: {
      type: Boolean,
      default: false,
    },

    userLogin: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "UserLogin",
      default: null,
    },

    walletBalance: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  {
    timestamps: true,
  }
);

UserSchema.pre("save", async function () {
  if (!this.uniqueId) {
    const randomDigits = Math.floor(100000 + Math.random() * 900000);
    this.uniqueId = `UB${randomDigits}`;
  }
});

module.exports = mongoose.model("User", UserSchema);