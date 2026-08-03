/**
 * Middleware to handle 404 (Not Found) errors for unmatched routes.
 */
const notFoundMiddleware = (req, res, next) => {
    res.status(404).json({
        success: false,
        message: `Route Not Found - ${req.method} ${req.originalUrl}`
    });
};

module.exports = notFoundMiddleware;
