const express = require("express");
const cors = require("cors");
const routes = require("./routes");
const notFoundMiddleware = require("./middlewares/notFound.middleware");
const errorMiddleware = require("./middlewares/error.middleware");

const app = express();

// Middlewares
app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

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