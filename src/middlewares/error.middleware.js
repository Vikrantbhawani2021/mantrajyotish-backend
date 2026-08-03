/**
 * Centralized Error Handling Middleware
 */
const errorMiddleware = (err, req, res, next) => {
    // Log the error stack in development or staging
    console.error(`[Error] ${req.method} ${req.url}:`, err.stack || err);

    const statusCode = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(statusCode).json({
        success: false,
        message: message,
        ...(process.env.NODE_ENV === "development" && { stack: err.stack })
    });
};

module.exports = errorMiddleware;
