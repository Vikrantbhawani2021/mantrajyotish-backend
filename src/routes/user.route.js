const express = require("express");

const router = express.Router();

const userController = require("../controllers/user.controller");
const authMiddleware = require("../middlewares/auth.middleware");
const adminMiddleware = require("../middlewares/admin.middleware");

// Public & Registration routes
router.post("/register", userController.registerUser);
router.post("/create", userController.registerUser);

// Admin & Listing routes
router.get("/all", authMiddleware, adminMiddleware, userController.getAllUsers);
router.get("/profile", authMiddleware, userController.getProfile);
router.get("/:id", authMiddleware, adminMiddleware, userController.getUserById);

// Update & Delete routes
router.put("/profile", authMiddleware, userController.updateProfile);
router.put("/update/:id", authMiddleware, adminMiddleware, userController.updateProfile);
router.put("/:id", authMiddleware, adminMiddleware, userController.updateProfile);
router.delete("/delete/:id", authMiddleware, adminMiddleware, userController.deleteUser);
router.delete("/:id", authMiddleware, adminMiddleware, userController.deleteUser);

module.exports = router;