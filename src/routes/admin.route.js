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

// Dashboard Statistics
const adminMiddleware = require("../middlewares/admin.middleware");
router.get("/dashboard-stats", authMiddleware, adminMiddleware, adminController.getDashboardStats);

// Admin Astrologer CRUD Management
router.get("/astrologers", authMiddleware, adminMiddleware, adminController.getAstrologers);
router.get("/astrologers/:id", authMiddleware, adminMiddleware, adminController.getAstrologerById);
router.put("/astrologers/:id", authMiddleware, adminMiddleware, adminController.updateAstrologer);
router.delete("/astrologers/:id", authMiddleware, adminMiddleware, adminController.deleteAstrologer);

module.exports = router;
