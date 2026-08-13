const express = require("express");
const cors = require("cors");
const routes = require("./routes");
const notFoundMiddleware = require("./middlewares/notFound.middleware");
const errorMiddleware = require("./middlewares/error.middleware");

const connectDB = require("./config/db");

const app = express();

// Middlewares
app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// Middleware to ensure DB is connected on serverless platforms (Vercel)
app.use(async (req, res, next) => {
    try {
        await connectDB();
        next();
    } catch (err) {
        console.error("Database connection error:", err);
        return res.status(500).json({
            success: false,
            message: "Database connection failed"
        });
    }
});

// Health Check Endpoint
app.get("/", (req, res) => {
    res.json({
        success: true,
        message: "Backend API Service Running Successfully"
    });
});

// API Routes
app.use("/api", routes);

// 404 Handler
app.use(notFoundMiddleware);

// Global Error Handler
app.use(errorMiddleware);

module.exports = app;