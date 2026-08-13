const express = require("express");

const router = express.Router();

const adminController = require("../controllers/admin.controller");
const authMiddleware = require("../middlewares/auth.middleware");

// Admin Registration & Login
router.post("/register", authMiddleware, adminController.registerAdmin);
router.post("/create", authMiddleware, adminController.registerAdmin);
router.post("/login", adminController.loginAdmin);

// Logged-in Admin Profile
router.get("/profile", authMiddleware, adminController.getProfile);

module.exports = router;
